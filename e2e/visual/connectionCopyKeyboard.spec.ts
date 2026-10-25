import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { dismissRejectedApproval } from '../harness/dismissRejectedApproval';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
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

const tabTo = async (page: Page, control: Locator) => {
  for (let index = 0; index < 30; index += 1) {
    if (await control.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
};

const publicState = (page: Page, host: string) =>
  page.evaluate(async (origin) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const persisted = await chrome.storage.local.get('state');
    const reference = state.vault.activeAccount;
    const project = (grant: any) =>
      grant
        ? {
            accountId: grant.accountId,
            accountType: grant.accountType,
            host: grant.host,
          }
        : null;
    return {
      active: {
        ...reference,
        address: state.vault.accounts[reference.type][reference.id].address,
      },
      accounts: Object.values(state.vault.accounts.HDAccount).map(
        (account: any) => ({
          id: account.id,
          label: account.label,
          address: account.address,
        })
      ),
      grant: project(state.dapp.dapps[origin]),
      savedGrant: project(persisted.state?.dapp?.dapps?.[origin]),
    };
  }, host);

test('connection account Copy supports keyboard activation without changing selection or granting access', async ({}, info) => {
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
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ConnectionCopyKeyboardSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let popup: Page | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('connection-copy-keyboard', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    const host = new URL(server.url).origin;
    let before: Awaited<ReturnType<typeof publicState>>;
    let first: { address: string; id: number; label: string };
    const secondLabel = 'Keyboard approval account';
    await wallet.step(
      'prepare two accounts using the ordinary account creation UI',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.gotoRoute('#/settings/account/new');
        await wallet!.page.locator('#account-name-input').fill(secondLabel);
        await wallet!.page.locator('#create-btn').click();
        await wallet!.page
          .getByRole('button', { name: en.buttons.ok, exact: true })
          .click();
        await wallet!.ensureOnHome();
        before = await publicState(wallet!.page, host);
        expect(before.active.id).toBe(1);
        expect(before.accounts).toHaveLength(2);
        expect(before.grant).toBeNull();
        expect(before.savedGrant).toBeNull();
        first = before.accounts.find((account) => account.id === 0)!;
        expect(first.address).not.toBe(before.active.address);
        observations.before = before;
      }
    );

    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() =>
      Boolean((window as any).__paliConformanceProvider && (window as any).pali)
    );
    const requestId = await startRequest(dapp, 'eth_requestAccounts');
    popup = await popupFor(wallet.context, dapp, requestId);
    await popup.setViewportSize({ width: 400, height: 620 });
    const approval = popup;
    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 360 },
    ]) {
      await approval.setViewportSize(viewport);
      for (const action of [en.buttons.cancel, en.buttons.confirm]) {
        const button = approval.getByRole('button', {
          name: action,
          exact: true,
        });
        await expect(button).toBeEnabled();
        await approval.mouse.move(0, 0);
        await captureForegroundContrast(
          button,
          info,
          `connection-${action}-default-${viewport.width}`
        );
        await button.hover();
        await captureForegroundContrast(
          button,
          info,
          `connection-${action}-hover-${viewport.width}`
        );
        // Accent fill and label changes must stay readable during hover too.
        expect(
          await button.evaluate(
            (node) => getComputedStyle(node).transitionProperty
          )
        ).not.toMatch(/(^|,\s*)(all|color|background-color)(,|$)/);
      }
      await approval.mouse.move(0, 0);
      await captureForegroundContrast(
        approval.getByRole('link', {
          name: en.connections.learnMore,
          exact: true,
        }),
        info,
        `connection-learn-more-${viewport.width}`
      );
    }
    await approval.mouse.move(0, 0);
    await approval.setViewportSize({ width: 400, height: 620 });
    const accountRow = (label: string) =>
      approval.locator('[role="button"][tabindex="0"]').filter({
        has: approval.getByText(label, { exact: true }),
      });
    const firstRow = accountRow(first!.label);
    await firstRow.scrollIntoViewIfNeeded();
    const secondRow = accountRow(secondLabel);
    const firstCopy = firstRow.getByRole('button', {
      name: en.transactions.copyAddress,
      exact: true,
    });
    await expect(firstRow).toHaveCount(1);
    await expect(secondRow).toHaveClass(/shadow-md/);
    await expect(firstRow).not.toHaveClass(/shadow-md/);
    // Observe the real clipboard call and its actual settlement, not a stubbed
    // controller or a manufactured clipboard result. Only synthetic public
    // fixture addresses are recorded; no system clipboard read is performed.
    await approval.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(
        navigator.clipboard,
        'writeText'
      );
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      const audit = { writes: [] as string[], failures: 0 };
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async (text: string) => {
          try {
            await original(text);
            audit.writes.push(text);
          } catch (error) {
            audit.failures += 1;
            throw error;
          }
        },
      });
      (window as any).__connectionCopyAudit = {
        snapshot: () => ({ ...audit, writes: [...audit.writes] }),
        restore: () => {
          if (descriptor)
            Object.defineProperty(navigator.clipboard, 'writeText', descriptor);
          else delete (navigator.clipboard as any).writeText;
        },
      };
    });
    const copyAudit = () =>
      approval.evaluate(() => (window as any).__connectionCopyAudit.snapshot());
    const assertNoGrant = async () => {
      expect(await publicState(wallet!.page, host)).toEqual(before);
      expect((await rpcObservation(dapp, requestId)).settled).not.toBe(true);
    };

    await wallet.step(
      'keyboard Copy preserves the selected account for Enter and Space',
      async (capture) => {
        await approval.mouse.move(0, 0);
        let copies = 0;
        for (const key of ['Enter', 'Space']) {
          await tabTo(approval, firstCopy);
          await expect(firstCopy).toBeFocused();
          await expect(firstCopy).toHaveCSS('opacity', '1');
          await approval.keyboard.press(key);
          copies += 1;
          await expect.poll(copyAudit).toEqual({
            writes: Array(copies).fill(first!.address),
            failures: 0,
          });
          await expect(secondRow).toHaveClass(/shadow-md/);
          await expect(firstRow).not.toHaveClass(/shadow-md/);
          await assertNoGrant();
        }
        observations.keyboardCopies = await copyAudit();
        await capture(approval);
      }
    );
    await wallet.step(
      'mouse Copy and keyboard row selection remain separate healthy actions',
      async (capture) => {
        await firstCopy.click();
        await expect
          .poll(copyAudit)
          .toEqual({ writes: Array(3).fill(first!.address), failures: 0 });
        await expect(secondRow).toHaveClass(/shadow-md/);
        await tabTo(approval, firstRow);
        await approval.keyboard.press('Enter');
        await expect(firstRow).toHaveClass(/shadow-md/);
        await expect(secondRow).not.toHaveClass(/shadow-md/);
        await tabTo(approval, secondRow);
        await approval.keyboard.press('Space');
        await expect(secondRow).toHaveClass(/shadow-md/);
        await expect(firstRow).not.toHaveClass(/shadow-md/);
        await expect
          .poll(copyAudit)
          .toEqual({ writes: Array(3).fill(first!.address), failures: 0 });
        await assertNoGrant();
        observations.healthyControls = await copyAudit();
        await capture(approval);
      }
    );
    await wallet.step(
      'cancel the original real request without a grant or account change',
      async () => {
        await approval.evaluate(() =>
          (window as any).__connectionCopyAudit.restore()
        );
        const result = await dismissRejectedApproval({
          click: () =>
            approval
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click(),
          isClosed: () => approval.isClosed(),
          settle: () => settle(dapp, requestId),
        });
        // Connection middleware maps cancelled Connect to unauthorized, unlike
        // signing cancellation. Keep its established exact provider error.
        expect(result.error?.code).toBe(4100);
        expect(result.error?.message).toBe('Connection required');
        expect(result.result).toBeUndefined();
        expect(await publicState(wallet!.page, host)).toEqual(before);
        observations.rejectionCode = result.error?.code;
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = 'passed';
  } finally {
    try {
      await info.attach('connection-copy-keyboard-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceSha256,
          observations,
          fixtureReads: routes?.reads ?? [],
          deniedWrites: routes?.deniedWrites ?? [],
          proxyDeniedConnections: server.blocked.length,
          fullDappRequestLifecycle: true,
          controllerStateReplaced: false,
          controllerResultReplaced: false,
          clipboardObservedThroughOriginalMethod: true,
          clipboardReadRequested: false,
          signingOrBroadcastRequested: false,
        }),
      });
    } finally {
      try {
        if (popup && !popup.isClosed())
          await popup
            .evaluate(() => (window as any).__connectionCopyAudit?.restore())
            .catch(() => undefined);
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
