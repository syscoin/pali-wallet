import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
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
  providerRequest,
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
            chain: grant.chain,
            chainId: grant.chainId,
            date: grant.date,
            logo: grant.logo ?? null,
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

test('change-account Copy supports keyboard activation without changing the selected account or saved grant', async ({}, info) => {
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
    password: 'ChangeAccountCopySynthetic!2026',
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
    wallet = await PaliWallet.launch('change-account-copy-keyboard', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    const host = new URL(server.url).origin;
    const secondLabel = 'Keyboard change-account';
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
        const before = await publicState(wallet!.page, host);
        expect(before.active.id).toBe(1);
        expect(before.accounts).toHaveLength(2);
        expect(before.grant).toBeNull();
        expect(before.savedGrant).toBeNull();
      }
    );

    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() =>
      Boolean((window as any).__paliConformanceProvider && (window as any).pali)
    );
    let baseline: Awaited<ReturnType<typeof publicState>>;
    await wallet.step(
      'grant the active account through the real Connect UI',
      async () => {
        const result = await approve(
          wallet!.context,
          dapp,
          await startRequest(dapp, 'eth_requestAccounts')
        );
        baseline = await publicState(wallet!.page, host);
        expect(baseline.active.id).toBe(1);
        expect(baseline.grant).toMatchObject({
          accountId: 1,
          accountType: baseline.active.type,
          host,
        });
        await expect
          .poll(async () => (await publicState(wallet!.page, host)).savedGrant)
          .toEqual(baseline.grant);
        baseline = await publicState(wallet!.page, host);
        expect(
          result.result.map((address: string) => address.toLowerCase())
        ).toEqual([baseline.active.address.toLowerCase()]);
        observations.baseline = baseline;
      }
    );

    await wallet.step(
      'existing account permissions return without another approval',
      async () => {
        // This supported request intentionally short-circuits for a connected
        // EVM origin. Do not force it to show a ChangeAccount popup.
        const permissions = await providerRequest(
          dapp,
          'wallet_requestPermissions',
          [{ ['eth_accounts']: {} }]
        );
        const accountPermission = permissions.find(
          (permission: any) => permission.parentCapability === 'eth_accounts'
        );
        expect(
          accountPermission.caveats[0].value.map((address: string) =>
            address.toLowerCase()
          )
        ).toEqual([baseline!.active.address.toLowerCase()]);
        expect(
          wallet!.context
            .pages()
            .filter((page) => page.url().includes('/external'))
        ).toHaveLength(0);
        expect(await publicState(wallet!.page, host)).toEqual(baseline!);
        observations.existingPermissions = permissions;
      }
    );

    // wallet_changeAccount is the ordinary connected-origin producer for the
    // ChangeAccount screen; eth_accounts permission requests above are cached.
    const requestId = await startRequest(dapp, 'wallet_changeAccount');
    popup = await popupFor(wallet.context, dapp, requestId);
    await popup.setViewportSize({ width: 400, height: 620 });
    const approval = popup;
    await expect(
      approval.getByText(en.connections.changeAccount, { exact: true })
    ).toBeVisible();
    const pendingRequest = await rpcObservation(dapp, requestId);
    expect(pendingRequest.method).toBe('wallet_changeAccount');
    expect(pendingRequest.settled).not.toBe(true);
    const first = baseline!.accounts.find((account) => account.id === 0)!;
    expect(first.address).not.toBe(baseline!.active.address);
    const accountRow = (label: string) =>
      approval.locator('[role="button"][tabindex="0"]').filter({
        has: approval.getByText(label, { exact: true }),
      });
    const firstRow = accountRow(first.label);
    const secondRow = accountRow(secondLabel);
    const firstCopy = firstRow.getByRole('button', {
      name: en.transactions.copyAddress,
      exact: true,
    });
    await expect(firstRow).toHaveCount(1);
    await expect(secondRow).toHaveClass(/shadow-md/);
    await expect(firstRow).not.toHaveClass(/shadow-md/);
    // Observe successful writes through the original Clipboard method. No
    // clipboard read, controller replacement, or fabricated result is used.
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
      (window as any).__changeAccountCopyAudit = {
        snapshot: () => ({ ...audit, writes: [...audit.writes] }),
        restore: () => {
          if (descriptor)
            Object.defineProperty(navigator.clipboard, 'writeText', descriptor);
          else delete (navigator.clipboard as any).writeText;
        },
      };
    });
    const copyAudit = () =>
      approval.evaluate(() =>
        (window as any).__changeAccountCopyAudit.snapshot()
      );
    const assertUnchanged = async () => {
      expect(await publicState(wallet!.page, host)).toEqual(baseline!);
      expect(await rpcObservation(dapp, requestId)).toEqual(pendingRequest);
    };

    await wallet.step(
      'keyboard Copy leaves the connected account selected and the request pending',
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
            writes: Array(copies).fill(first.address),
            failures: 0,
          });
          await expect(secondRow).toHaveClass(/shadow-md/);
          await expect(firstRow).not.toHaveClass(/shadow-md/);
          await assertUnchanged();
        }
        observations.keyboardCopies = await copyAudit();
        await capture(approval);
      }
    );
    await wallet.step(
      'mouse Copy and keyboard row selection remain distinct healthy actions',
      async (capture) => {
        await firstCopy.click();
        await expect
          .poll(copyAudit)
          .toEqual({ writes: Array(3).fill(first.address), failures: 0 });
        await expect(secondRow).toHaveClass(/shadow-md/);
        await expect(firstRow).not.toHaveClass(/shadow-md/);
        await assertUnchanged();
        await tabTo(approval, firstRow);
        await approval.keyboard.press('Enter');
        await expect(firstRow).toHaveClass(/shadow-md/);
        await expect(secondRow).not.toHaveClass(/shadow-md/);
        await assertUnchanged();
        await tabTo(approval, secondRow);
        await approval.keyboard.press('Space');
        await expect(secondRow).toHaveClass(/shadow-md/);
        await expect(firstRow).not.toHaveClass(/shadow-md/);
        await expect
          .poll(copyAudit)
          .toEqual({ writes: Array(3).fill(first.address), failures: 0 });
        await assertUnchanged();
        observations.healthyControls = await copyAudit();
        await capture(approval);
      }
    );
    await wallet.step(
      'ordinary short account identity stays readable and keyboard actions remain distinct at narrow width',
      async () => {
        expect(first.label).toBe('Account 1');
        for (const viewport of [
          { width: 320, height: 360 },
          { width: 400, height: 620 },
        ]) {
          await approval.setViewportSize(viewport);
          const label = firstRow.getByText(first.label, { exact: true });
          const footer = approval
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .locator(
              'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " fixed ")][1]'
            );
          await expect(footer).toBeVisible();
          await expect(label).toBeVisible();
          if (viewport.width === 320) {
            const search = approval.getByRole('searchbox', {
              name: en.connections.searchAccounts,
              exact: true,
            });
            await search.click();
            await expect(search).toBeFocused();
            await tabTo(approval, firstRow);
            await expect(firstRow).toBeFocused();
            const focusedRow = await firstRow.boundingBox();
            const focusedFooter = await footer.boundingBox();
            expect(focusedRow).not.toBeNull();
            expect(focusedFooter).not.toBeNull();
            observations.narrowFocusBeforeWheel = {
              focused: true,
              row: focusedRow,
              footerTop: focusedFooter!.y,
              entirelyAboveFooter:
                focusedRow!.y >= 0 &&
                focusedRow!.y + focusedRow!.height <= focusedFooter!.y,
              labelCenterUnoccluded: await label.evaluate((element) => {
                const bounds = element.getBoundingClientRect();
                const hit = document.elementFromPoint(
                  bounds.left + bounds.width / 2,
                  bounds.top + bounds.height / 2
                );
                const row = element.closest('[role="button"][tabindex="0"]');
                return (
                  !!hit &&
                  (hit === element || element.contains(hit) || hit === row)
                );
              }),
            };
            expect(observations.narrowFocusBeforeWheel).toMatchObject({
              focused: true,
              entirelyAboveFooter: true,
              labelCenterUnoccluded: true,
            });
            await info.attach('change-account-native-focus-320', {
              body: await approval.screenshot({
                animations: 'disabled',
                mask: [approval.locator('textarea,input[type=password]')],
              }),
              contentType: 'image/png',
            });
          }
          for (let attempt = 0; attempt < 24; attempt++) {
            const rowBox = await firstRow.boundingBox();
            const footerBox = await footer.boundingBox();
            expect(rowBox).not.toBeNull();
            expect(footerBox).not.toBeNull();
            if (rowBox!.y >= 0 && rowBox!.y + rowBox!.height <= footerBox!.y)
              break;
            await approval.mouse.move(
              viewport.width / 2,
              Math.min(viewport.height / 2, footerBox!.y - 8)
            );
            await approval.mouse.wheel(0, rowBox!.y < 0 ? -120 : 120);
            await approval.waitForTimeout(100);
          }
          const rowBox = await firstRow.boundingBox();
          const footerBox = await footer.boundingBox();
          expect(rowBox).not.toBeNull();
          expect(footerBox).not.toBeNull();
          expect(rowBox!.x).toBeGreaterThanOrEqual(0);
          expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(viewport.width);
          expect(rowBox!.y).toBeGreaterThanOrEqual(0);
          expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(footerBox!.y);
          await expect(label).toBeInViewport({ ratio: 1 });
          expect(
            await label.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              const hit = document.elementFromPoint(
                bounds.left + bounds.width / 2,
                bounds.top + bounds.height / 2
              );
              const row = element.closest('[role="button"][tabindex="0"]');
              return (
                !!hit &&
                (hit === element || element.contains(hit) || hit === row)
              );
            })
          ).toBe(true);
          const size = await label.evaluate((element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          }));
          expect(size.clientWidth).toBeGreaterThan(0);
          expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth + 1);
          await info.attach(`change-account-short-label-${viewport.width}`, {
            body: await approval.screenshot({
              animations: 'disabled',
              mask: [approval.locator('textarea,input[type=password]')],
            }),
            contentType: 'image/png',
          });
          if (viewport.width === 320) {
            await info.attach('change-account-short-label-row-320', {
              body: await firstRow.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
          }
        }
        await approval.setViewportSize({ width: 320, height: 360 });
        await tabTo(approval, firstCopy);
        await expect(firstCopy).toBeFocused();
        await approval.keyboard.press('Enter');
        await expect.poll(copyAudit).toEqual({
          writes: Array(4).fill(first.address),
          failures: 0,
        });
        await expect(secondRow).toHaveClass(/shadow-md/);
        await expect(firstRow).not.toHaveClass(/shadow-md/);
        await assertUnchanged();
        await tabTo(approval, firstRow);
        await approval.keyboard.press('Enter');
        await expect(firstRow).toHaveClass(/shadow-md/);
        await tabTo(approval, secondRow);
        await approval.keyboard.press('Space');
        await expect(secondRow).toHaveClass(/shadow-md/);
        await expect(firstRow).not.toHaveClass(/shadow-md/);
        await assertUnchanged();
      }
    );
    await wallet.step(
      'cancel the original change request and retain the saved grant',
      async () => {
        await approval.evaluate(() =>
          (window as any).__changeAccountCopyAudit.restore()
        );
        const result = await dismissRejectedApproval({
          click: () =>
            approval
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click(),
          isClosed: () => approval.isClosed(),
          settle: () => settle(dapp, requestId),
        });
        // ChangeAccount closes directly; popupPromise preserves user rejection.
        // It does not use Connect middleware's separate 4100 mapping.
        expect(result.error?.code).toBe(4001);
        expect(result.error?.message).toBe('User closed popup window');
        expect(result.result).toBeUndefined();
        expect(await publicState(wallet!.page, host)).toEqual(baseline!);
        observations.rejection = result.error;
      }
    );
    const requestMethods = await dapp.evaluate(() =>
      (window as any).__paliConformance.requests.map(
        (request: any) => request.method
      )
    );
    expect(requestMethods).toEqual([
      'eth_requestAccounts',
      'wallet_requestPermissions',
      'wallet_changeAccount',
    ]);
    observations.requestMethods = requestMethods;
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = 'passed';
  } finally {
    try {
      await info.attach('change-account-copy-keyboard-evidence', {
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
          grantCreatedOnlyByInitialConnect: true,
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
            .evaluate(() => (window as any).__changeAccountCopyAudit?.restore())
            .catch(() => undefined);
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
