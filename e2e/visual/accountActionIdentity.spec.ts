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

import en from '../../source/assets/locales/en.json';
import { ellipsis } from '../../source/utils/format';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Ordinary HD creation and
// EditAccount saves are the only account mutations. No private import, removal,
// signing, injected state, controller replacement, or provider replacement.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const MANAGE = 'ul[data-navigation-scroll="settings-manage-accounts"]';
const LABELS = ['Daily spending control', 'Savings control'];
const SHARED_LABEL = 'Daily';
type PublicAccount = {
  kind: string;
  id: number;
  label: string;
  address: string;
};

async function accountProjection(page: Page) {
  return page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const disk = await chrome.storage.local.get(key);
    const project = (accounts: any) =>
      Object.entries(accounts || {})
        .flatMap(([kind, group]: [string, any]) =>
          Object.values(group || {}).map((account: any) => ({
            kind,
            id: account.id,
            label: account.label,
            address: account.address,
          }))
        )
        .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
    return {
      active: state.vault.activeAccount,
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
      },
      live: project(state.vault.accounts),
      persisted: project(disk[key]?.accounts),
    };
  });
}

async function nativeAX(
  context: BrowserContext,
  page: Page,
  target: Locator,
  selector: string,
  role: string
) {
  const index = await target.evaluate(
    (node, query) => Array.from(document.querySelectorAll(query)).indexOf(node),
    selector
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const cdp = await context.newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector,
    });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
      nodeId: nodeIds[index],
      fetchRelatives: false,
    });
    const node = nodes.find(
      (item) => item.role?.value === role && !item.ignored
    );
    expect(node).toBeDefined();
    return {
      role: node!.role?.value,
      name: String(node!.name?.value ?? ''),
      description: node!.description?.value ?? null,
      dom: await target.evaluate((element) => ({
        title: element.getAttribute('title'),
        ariaLabel: element.getAttribute('aria-label'),
        labelledBy: element.getAttribute('aria-labelledby'),
        describedBy: element.getAttribute('aria-describedby'),
      })),
    };
  } finally {
    await cdp.detach();
  }
}

// The production clipboard call still reaches Chromium. Only successful,
// allowlisted public address bytes are recorded, and the wrapper is restored.
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
    (window as any).__accountIdentityPublicClipboard = {
      snapshot: () => ({ ...audit, writes: [...audit.writes] }),
      restore: () => {
        if (descriptor)
          Object.defineProperty(navigator.clipboard, 'writeText', descriptor);
        else delete (navigator.clipboard as any).writeText;
      },
    };
  }, addresses);
}

test('account actions and removal dialogs distinguish duplicate editable labels', async ({}, info) => {
  expect(process.version).toBe('v23.11.1');
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
    password: 'AccountIdentitySyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = { runtime, sourceSha256 };
  const forbiddenRequests: string[] = [];
  const pageErrors: string[] = [];
  let profileRemoved = false;
  try {
    wallet = await PaliWallet.launch('account-action-identity', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    observations.workerIdentity = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (value) => {
        observations.workerIdentity = value;
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    wallet.context.on('request', (request) => {
      if (/\/sendtx(?:\/|$)/i.test(request.url()))
        forbiddenRequests.push('sendtx');
      try {
        const body = request.postDataJSON();
        for (const call of Array.isArray(body) ? body : [body])
          if (
            /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
            forbiddenRequests.push(call.method);
      } catch {
        /* ordinary GET */
      }
    });
    const openGeneral = async (name: string) => {
      await wallet!.ensureOnHome();
      await page
        .getByRole('button', {
          name: en.generalMenu.generalOptions,
          exact: true,
        })
        .click();
      await page.getByRole('menuitem', { name, exact: true }).click();
    };
    const selectAnchor = async () => {
      await wallet!.ensureOnHome();
      await page.locator('#general-settings-button').click();
      await page
        .locator('#account-HDAccount-0')
        .getByRole('menuitem')
        .first()
        .click();
      await expect
        .poll(async () => (await accountProjection(page)).active)
        .toEqual({ id: 0, type: 'HDAccount' });
      await wallet!.ensureOnHome();
    };
    const rowFor = (account: PublicAccount) =>
      page
        .locator(`${MANAGE} li`)
        .filter({ hasText: `(${ellipsis(account.address, 4, 4)})` });
    const action = (account: PublicAccount, label: string) =>
      rowFor(account).getByRole('button', { name: new RegExp(`^${label}:`) });
    const activate = async (target: Locator, keyboard: boolean) => {
      await target.scrollIntoViewIfNeeded();
      if (keyboard) {
        await target.focus();
        await expect(target).toBeFocused();
        await page.keyboard.press('Enter');
      } else await target.click();
    };
    const inspectEdit = async (account: PublicAccount, keyboard: boolean) => {
      await expect(rowFor(account)).toHaveCount(1);
      await activate(action(account, en.buttons.edit), keyboard);
      await expect(page).toHaveURL(/#\/settings\/edit-account$/);
      const route = await page.evaluate(() => ({
        id: history.state?.usr?.id,
        accountType: history.state?.usr?.accountType,
      }));
      expect(route).toEqual({ id: account.id, accountType: 'HDAccount' });
      await expect(
        page.getByPlaceholder(en.settings.accountLabel, { exact: true })
      ).toHaveValue(account.label);
      await expect(
        page
          .locator('p[title]')
          .filter({ hasText: ellipsis(account.address, 12, 14) })
      ).toHaveAttribute('title', account.address);
      return {
        route,
        address: account.address,
        activation: keyboard ? 'native Enter on focused Edit' : 'pointer',
      };
    };

    await wallet.step(
      'create two ordinary HD accounts with distinct labels and restore the active anchor',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        for (const label of LABELS) {
          await openGeneral(en.accountMenu.createNewAccount);
          await page.locator('#account-name-input').fill(label);
          await page.locator('#create-btn').click();
          await page
            .getByRole('button', { name: en.buttons.ok, exact: true })
            .click();
        }
        await selectAnchor();
      }
    );
    const initial = await accountProjection(page);
    expect(initial.active).toEqual({ id: 0, type: 'HDAccount' });
    expect(initial.network).toEqual({ kind: 'ethereum', chainId: 5700 });
    expect(initial.persisted).toEqual(initial.live);
    const targets = LABELS.map((label, index) => {
      const account = initial.live.find(
        (a) => a.kind === 'HDAccount' && a.id === index + 1
      );
      expect(account?.label).toBe(label);
      expect(account?.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      return account!;
    });
    expect(new Set(targets.map((a) => a.address.toLowerCase())).size).toBe(2);
    expect(new Set(targets.map((a) => ellipsis(a.address, 4, 4))).size).toBe(2);
    observations.initial = initial;

    await wallet.step(
      'healthy distinct-label actions target their exact edit routes and save duplicates through the real form',
      async () => {
        await openGeneral(en.accountMenu.manageAccounts);
        const distinct = [];
        for (const account of targets) {
          const edit = await nativeAX(
            wallet!.context,
            page,
            action(account, en.buttons.edit),
            `${MANAGE} button`,
            'button'
          );
          const remove = await nativeAX(
            wallet!.context,
            page,
            action(account, en.buttons.remove),
            `${MANAGE} button`,
            'button'
          );
          expect(edit.name).toContain(account.label);
          expect(remove.name).toContain(account.label);
          distinct.push({ account, edit, remove });
        }
        expect(new Set(distinct.map((entry) => entry.edit.name)).size).toBe(2);
        expect(new Set(distinct.map((entry) => entry.remove.name)).size).toBe(
          2
        );
        observations.distinctLabelActions = distinct;
        const saves = [];
        for (const [index, account] of targets.entries()) {
          const edit = await inspectEdit(account, index === 1);
          await page
            .getByPlaceholder(en.settings.accountLabel, { exact: true })
            .fill(SHARED_LABEL);
          await page
            .getByRole('button', { name: en.buttons.save, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
          await expect
            .poll(async () => {
              const snapshot = await accountProjection(page);
              return {
                live: snapshot.live.find(
                  (a) => a.kind === account.kind && a.id === account.id
                )?.label,
                persisted: snapshot.persisted.find(
                  (a) => a.kind === account.kind && a.id === account.id
                )?.label,
              };
            })
            .toEqual({ live: SHARED_LABEL, persisted: SHARED_LABEL });
          saves.push(edit);
        }
        observations.exactRenameRoutes = saves;
      }
    );
    const duplicateState = await accountProjection(page);
    const expectedDuplicates = initial.live.map((a) =>
      targets.some((target) => target.kind === a.kind && target.id === a.id)
        ? { ...a, label: SHARED_LABEL }
        : a
    );
    expect(duplicateState.live).toEqual(expectedDuplicates);
    expect(duplicateState.persisted).toEqual(expectedDuplicates);
    expect(duplicateState.active).toEqual(initial.active);
    const duplicates = targets.map((account) => ({
      ...account,
      label: SHARED_LABEL,
    }));
    observations.duplicateState = duplicateState;

    await wallet.step(
      'inspect duplicate-label native actions and keep exact Edit targets',
      async () => {
        const duplicateActions = [];
        const exactRoutes = [];
        for (const [index, account] of duplicates.entries()) {
          const row = rowFor(account);
          const rowAX = await nativeAX(
            wallet!.context,
            page,
            row,
            `${MANAGE} li`,
            'listitem'
          );
          const edit = await nativeAX(
            wallet!.context,
            page,
            action(account, en.buttons.edit),
            `${MANAGE} button`,
            'button'
          );
          const remove = await nativeAX(
            wallet!.context,
            page,
            action(account, en.buttons.remove),
            `${MANAGE} button`,
            'button'
          );
          duplicateActions.push({
            account,
            rowText: await row.innerText(),
            rowAX,
            edit,
            remove,
          });
          expect
            .soft(
              edit.name,
              'Edit must identify the selected public address in native AX'
            )
            .toBe(`${en.buttons.edit}: ${account.label} (${account.address})`);
          expect
            .soft(
              remove.name,
              'Remove must identify the selected public address in native AX'
            )
            .toBe(
              `${en.buttons.remove}: ${account.label} (${account.address})`
            );
          exactRoutes.push(await inspectEdit(account, index === 1));
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
          expect(await accountProjection(page)).toEqual(duplicateState);
        }
        expect
          .soft(new Set(duplicateActions.map((entry) => entry.edit.name)).size)
          .toBe(2);
        expect
          .soft(
            new Set(duplicateActions.map((entry) => entry.remove.name)).size
          )
          .toBe(2);
        observations.duplicateActions = duplicateActions;
        observations.exactDuplicateEditRoutes = exactRoutes;
      }
    );

    await wallet.step(
      'open each genuine removal confirmation and Cancel without changing either account',
      async () => {
        const dialogs = [];
        for (const [index, account] of duplicates.entries()) {
          if (index === 1)
            await page.setViewportSize({ width: 320, height: 360 });
          await activate(action(account, en.buttons.remove), index === 1);
          const dialog = page.getByRole('dialog', {
            name: en.settings.removeAccount,
            exact: true,
          });
          await expect(dialog).toBeVisible();
          for (const name of [en.buttons.cancel, en.buttons.remove])
            await expect(
              dialog.getByRole('button', { name, exact: true })
            ).toBeInViewport();
          const text = await dialog.innerText();
          const layout = await dialog
            .locator('p')
            .first()
            .evaluate((paragraph) => {
              const body = paragraph.parentElement!;
              return {
                paragraphWidth: paragraph.clientWidth,
                paragraphScrollWidth: paragraph.scrollWidth,
                bodyWidth: body.clientWidth,
                bodyScrollWidth: body.scrollWidth,
              };
            });
          expect
            .soft(layout.paragraphScrollWidth)
            .toBeLessThanOrEqual(layout.paragraphWidth);
          expect
            .soft(layout.bodyScrollWidth)
            .toBeLessThanOrEqual(layout.bodyWidth);
          const ax = await nativeAX(
            wallet!.context,
            page,
            dialog,
            '[role="dialog"]',
            'dialog'
          );
          expect(text).toContain(SHARED_LABEL);
          expect
            .soft(
              text,
              'Confirmation must show the exact selected public address'
            )
            .toContain(account.address);
          await wallet!.shot(
            `HDAccount-${account.id}-duplicate-label-removal-public-identity`
          );
          await activate(
            dialog.getByRole('button', {
              name: en.buttons.cancel,
              exact: true,
            }),
            index === 1
          );
          await expect(dialog).toHaveCount(0);
          expect(await accountProjection(page)).toEqual(duplicateState);
          dialogs.push({
            account,
            text,
            layout,
            ax,
            activation:
              index === 1
                ? 'native Enter on focused Remove and Cancel'
                : 'pointer',
            destructiveConfirmationClicked: false,
          });
        }
        observations.removalDialogs = dialogs;
        await page.setViewportSize({ width: 400, height: 620 });
      }
    );

    await wallet.step(
      'observe adjacent Header Copy identity and exact native public clipboard bytes',
      async () => {
        await wallet!.ensureOnHome();
        await installPublicClipboardAudit(
          page,
          duplicates.map((a) => a.address)
        );
        const header = [];
        try {
          for (const [index, account] of duplicates.entries()) {
            await page.locator('#general-settings-button').click();
            const row = page.locator(`#account-HDAccount-${account.id}`);
            const select = row.getByRole('menuitem').first();
            const copy = row.getByRole('menuitem', {
              name: new RegExp(`^${en.buttons.copy}:`),
            });
            const selectionAX = await nativeAX(
              wallet!.context,
              page,
              select,
              '[id^="account-HDAccount-"] button',
              'menuitem'
            );
            const copyAX = await nativeAX(
              wallet!.context,
              page,
              copy,
              '[id^="account-HDAccount-"] button',
              'menuitem'
            );
            expect(selectionAX.name).toContain(account.address);
            expect
              .soft(
                copyAX.name,
                'Adjacent Copy action must distinguish duplicate account labels'
              )
              .toBe(
                `${en.buttons.copy}: ${account.label} (${account.address})`
              );
            await activate(copy, index === 1);
            await expect
              .poll(async () =>
                page.evaluate(
                  () =>
                    (window as any).__accountIdentityPublicClipboard.snapshot()
                      .writes
                )
              )
              .toHaveLength(index + 1);
            header.push({
              account,
              selectionAX,
              copyAX,
              activation:
                index === 1 ? 'native Enter on focused Copy' : 'pointer',
            });
            // Headless UI normally closes on activation. Escape also safely closes
            // a still-open menu without selecting an account or altering the DOM.
            await page.keyboard.press('Escape');
            expect(await accountProjection(page)).toEqual(duplicateState);
          }
          const clipboard = await page.evaluate(() =>
            (window as any).__accountIdentityPublicClipboard.snapshot()
          );
          expect(clipboard).toEqual({
            writes: duplicates.map((a) => a.address),
            failures: 0,
            unexpectedValues: 0,
          });
          observations.adjacentHeader = {
            accounts: header,
            clipboard,
          };
        } finally {
          await page.evaluate(() =>
            (window as any).__accountIdentityPublicClipboard.restore()
          );
        }
      }
    );

    await wallet.step(
      'reload and verify durable public identities without removal or signing',
      async () => {
        await page.reload();
        await wallet!.waitAppReady();
        if (await page.locator('#login').isVisible()) await wallet!.unlock();
        await wallet!.ensureOnHome();
        const reloaded = await accountProjection(page);
        expect(reloaded).toEqual(duplicateState);
        observations.reloaded = reloaded;
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(forbiddenRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = info.errors.length ? 'failed' : 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
      if (wallet) {
        const profiles = path.resolve(E2E_CONFIG.artifactsDir, 'profiles');
        const profile = path.resolve(wallet.profileDir);
        const relative = path.relative(profiles, profile);
        if (
          !relative ||
          relative.startsWith('..') ||
          path.isAbsolute(relative) ||
          relative.includes(path.sep) ||
          fs.realpathSync(profiles) !== profiles ||
          !fs.lstatSync(profile).isDirectory() ||
          fs.lstatSync(profile).isSymbolicLink() ||
          fs.realpathSync(profile) !== profile
        )
          throw new Error('Disposable profile cleanup path refused');
        fs.rmSync(profile, { recursive: true, force: true });
        profileRemoved = true;
      }
    } finally {
      try {
        await info.attach('account-action-identity', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            observations,
            forbiddenRequests,
            pageErrors,
            fixtureReads: routes?.reads,
            deniedWrites: routes?.deniedWrites,
            proxyRefusals: server.blocked.length,
            traceRetained: false,
            videoRetained: false,
            rawProfileRemoved: profileRemoved,
            syntheticPrivateImport: false,
            destructiveConfirmationClicked: false,
            controllerStateReplaced: false,
          }),
        });
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
