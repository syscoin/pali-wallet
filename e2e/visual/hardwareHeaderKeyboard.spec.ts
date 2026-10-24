import { expect, test, type Page } from '@playwright/test';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Renderer-only public metadata fixture. This does not import a hardware
// account, contact a device, change the keyring, or validate device authority.
// It renders the real extension Header/dialog from the pinned production build.
const mode = process.env.PALI_HARDWARE_HEADER_MODE || 'after';
const BEFORE = 'fe41a0ed8d0097d0de9940e9057d44eb6ef60e4d';

async function publicInventory(page: Page) {
  return page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const saved = (await chrome.storage.local.get(key))[key];
    const project = (vault: any) => ({
      activeAccount: vault.activeAccount,
      accounts: Object.fromEntries(
        Object.entries(vault.accounts).map(([kind, accounts]) => [
          kind,
          Object.values(accounts as any).map((account: any) => ({
            id: account.id,
            address: account.address,
            xpub: account.xpub,
            label: account.label,
          })),
        ])
      ),
    });
    return {
      live: project(state.vault),
      saved: project(saved),
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
      },
      storageKey: key,
    };
  });
}

async function installHeaderProjection(page: Page, kind: 'Ledger' | 'Trezor') {
  await page.addInitScript((hardwareKind) => {
    const audit = {
      projected: 0,
      actions: [] as string[],
      refused: [] as string[],
      sourceIdentity: null as any,
      viewIdentity: null as any,
    };
    const identity = (account: any) => ({
      id: account.id,
      address: account.address,
      xpub: account.xpub,
    });
    let selected = { id: 0, type: 'HDAccount' };
    const projectAccounts = (accounts: any) => {
      const original = accounts?.[selected.type]?.[selected.id];
      if (!original)
        throw new Error('Missing real disposable account for renderer fixture');
      const result = structuredClone(accounts);
      result[hardwareKind] = {
        [selected.id]: {
          id: original.id,
          address: original.address,
          xpub: original.xpub,
          xprv: '',
          label: `Renderer ${hardwareKind} fixture`,
          balances: structuredClone(original.balances),
          isImported: false,
          isSmartAccount: false,
          isLedgerWallet: hardwareKind === 'Ledger',
          isTrezorWallet: hardwareKind === 'Trezor',
          slip44: original.slip44,
        },
      };
      audit.sourceIdentity = identity(original);
      audit.viewIdentity = identity(result[hardwareKind][selected.id]);
      return result;
    };
    const projectVault = (original: any) => {
      selected = { ...original.activeAccount };
      if (selected.type !== 'HDAccount' || !original.isBitcoinBased)
        throw new Error('Renderer fixture requires genuine HD UTXO source');
      const vault = structuredClone(original);
      vault.accounts = projectAccounts(original.accounts);
      vault.activeAccount = { id: selected.id, type: hardwareKind };
      for (const key of ['accountAssets', 'accountTransactions']) {
        vault[key] ||= {};
        vault[key][hardwareKind] = {
          [selected.id]: structuredClone(
            original[key]?.[selected.type]?.[selected.id] ||
              (key === 'accountAssets'
                ? { ethereum: [], syscoin: [] }
                : { ethereum: {}, syscoin: {} })
          ),
        };
      }
      audit.projected++;
      return vault;
    };
    const projectState = (original: any) =>
      original?.vault
        ? { ...original, vault: projectVault(original.vault) }
        : original;
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((...args: any[]) => {
      const [message, callback] = args;
      if (message?.type === 'getCurrentState') {
        if (typeof callback === 'function')
          return (send as any)(message, (state: any) =>
            callback(projectState(state))
          );
        return (send as any)(...args).then(projectState);
      }
      if (message?.type === 'CONTROLLER_ACTION') {
        const methods = message.data?.methods || [];
        audit.actions.push(methods.join('.'));
        if (
          methods.some((method: string) =>
            /^(?:verifyUtxoAddress|sign|send|broadcast|import|create|delete|remove|forget|resetWallet|resetLockedWallet|unlock|setActiveAccount)/i.test(
              method
            )
          )
        ) {
          audit.refused.push(methods.join('.'));
          const response = {
            error: 'Read-only hardware renderer fixture refused an action',
          };
          if (typeof callback === 'function') {
            queueMicrotask(() => callback(response));
            return;
          }
          return Promise.resolve(response);
        }
      }
      return (send as any)(...args);
    }) as typeof chrome.runtime.sendMessage;
    const add = chrome.runtime.onMessage.addListener.bind(
      chrome.runtime.onMessage
    );
    const remove = chrome.runtime.onMessage.removeListener.bind(
      chrome.runtime.onMessage
    );
    const wrappers = new Map<any, any>();
    chrome.runtime.onMessage.addListener = (listener: any) => {
      const wrapper = (message: any, ...rest: any[]) => {
        if (message?.type === 'CONTROLLER_STATE_CHANGE')
          return listener(
            { ...message, data: projectState(message.data) },
            ...rest
          );
        if (message?.type === 'CONTROLLER_NETWORK_CHANGE')
          return listener(
            {
              ...message,
              data: {
                ...message.data,
                vault: projectVault(message.data.vault),
              },
            },
            ...rest
          );
        if (message?.type === 'CONTROLLER_ACCOUNTS_CHANGE')
          return listener(
            { ...message, data: projectAccounts(message.data) },
            ...rest
          );
        if (message?.type === 'CONTROLLER_ACTIVE_ACCOUNT_CHANGE')
          return listener(
            { ...message, data: { ...message.data, type: hardwareKind } },
            ...rest
          );
        if (
          message?.type === 'CONTROLLER_ACCOUNT_BALANCE_CHANGE' &&
          message.data?.type === selected.type &&
          message.data?.id === selected.id
        )
          return listener(
            { ...message, data: { ...message.data, type: hardwareKind } },
            ...rest
          );
        return listener(message, ...rest);
      };
      wrappers.set(listener, wrapper);
      add(wrapper);
    };
    chrome.runtime.onMessage.removeListener = (listener: any) => {
      remove(wrappers.get(listener) || listener);
      wrappers.delete(listener);
    };
    (window as any).__hardwareHeaderRendererAudit = () =>
      structuredClone(audit);
  }, kind);
}

test('hardware address verification entry renders keyboard access without device authority', async ({}, info) => {
  test.setTimeout(180_000);
  expect(['before', 'after']).toContain(mode);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  if (mode === 'before') {
    expect(process.env.CI).toBeFalsy();
    expect(process.env.PALI_TEST_DAPP_REVISION).toBe(BEFORE);
  }
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'HeaderRendererSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let view: Page | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const records: unknown[] = [];
  try {
    wallet = await PaliWallet.launch(`hardware-header-renderer-${mode}`, {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.step(
      'prepare genuine disposable HD source for renderer-only hardware metadata',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
      }
    );
    const original = await publicInventory(wallet.page);
    expect(original.live.activeAccount.type).toBe('HDAccount');
    const source = original.live.accounts.HDAccount.find(
      (account: any) => account.id === original.live.activeAccount.id
    )!;
    const shortAddress =
      source.address.slice(0, 6) + '...' + source.address.slice(-14);
    for (const kind of ['Ledger', 'Trezor'] as const) {
      view = await wallet.context.newPage();
      await installHeaderProjection(view, kind);
      for (const viewport of [
        { width: 400, height: 620 },
        { width: 320, height: 360 },
      ]) {
        const label = `${kind.toLowerCase()}-${viewport.width}x${
          viewport.height
        }`;
        await wallet.step(
          `render ${label} public metadata fixture and verify keyboard entry`,
          async (capture) => {
            await view!.setViewportSize(viewport);
            await view!.goto(wallet!.appUrl('#/home'));
            await view!
              .locator('body.app-loaded')
              .waitFor({ state: 'attached' });
            await expect(view!.locator('#initial-loader')).toHaveCSS(
              'opacity',
              '0'
            );
            await expect(view!.locator('#app-root')).toHaveCSS('opacity', '1');
            const title = view!.getByTitle(`Renderer ${kind} fixture`, {
              exact: true,
            });
            await expect(title).toBeVisible();
            const header = title.locator('..').locator('..');
            const address = header.getByText(shortAddress, { exact: true });
            const copy = header.getByRole('button', {
              name: en.buttons.copy,
              exact: true,
            });
            await expect(address).toBeVisible();
            await info.attach(`${mode}-${label}-renderer-header`, {
              body: await view!.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
            const semantics = await address.evaluate((node) => ({
              tag: node.tagName,
              tabIndex: (node as HTMLElement).tabIndex,
              role: node.getAttribute('role'),
              label: node.getAttribute('aria-label'),
            }));
            let reached = false;
            for (let step = 0; step < 30; step++) {
              await view!.keyboard.press('Tab');
              if (
                await address.evaluate(
                  (node) => node === document.activeElement
                )
              ) {
                reached = true;
                break;
              }
              if (
                await copy.evaluate((node) => node === document.activeElement)
              )
                break;
            }
            expect(reached).toBe(mode === 'after');
            if (mode === 'before') {
              expect(semantics.tag).toBe('P');
              await address.click();
            } else {
              expect(semantics.tag).toBe('BUTTON');
              await expect(address).toHaveAccessibleName(
                en.home.clickToVerify.replace('{{currency}}', 'TSYS')
              );
              await view!.keyboard.press('Enter');
            }
            const dialog = view!.getByRole('dialog', {
              name: en.home.verifySysAddress.replace('{{currency}}', 'TSYS'),
              exact: true,
            });
            await expect(dialog).toBeVisible();
            await expect(
              dialog.getByRole('button', {
                name: en.buttons.verify,
                exact: true,
              })
            ).toBeEnabled();
            await info.attach(`${mode}-${label}-renderer-confirmation`, {
              body: await view!.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
            await capture(view!);
            await dialog
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click();
            await expect(dialog).toBeHidden();
            if (mode === 'after') await expect(address).toBeFocused();
            const audit = await view!.evaluate(() =>
              (window as any).__hardwareHeaderRendererAudit()
            );
            expect(audit.projected).toBeGreaterThan(0);
            expect(audit.sourceIdentity).toEqual(audit.viewIdentity);
            expect(audit.sourceIdentity).toEqual({
              id: source.id,
              address: source.address,
              xpub: source.xpub,
            });
            expect(audit.refused).toEqual([]);
            records.push({ kind, viewport, semantics, reached, audit });
          }
        );
      }
      await view.close();
      view = undefined;
    }
    await wallet.step(
      'retain actual HD authority and healthy passive HD address',
      async () => {
        expect(await publicInventory(wallet!.page)).toEqual(original);
        const title = wallet!.page.getByTitle(source.label, { exact: true });
        const address = title
          .locator('..')
          .locator('..')
          .getByText(shortAddress, { exact: true });
        await address.click();
        await expect(wallet!.page.getByRole('dialog')).toHaveCount(0);
        expect(routes.deniedWrites).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        await info.attach('hardware-renderer-proof-scope', {
          body: JSON.stringify(
            {
              runtime,
              original,
              records,
              rendererOnly: true,
              hardwareImported: false,
              deviceContacted: false,
              verifyClicked: false,
              controllerActionResponsesSubstituted: false,
              publicStateResponsesProjected: true,
            },
            null,
            2
          ),
          contentType: 'application/json',
        });
      }
    );
    status = 'passed';
  } finally {
    if (view && !view.isClosed()) await view.close();
    await wallet?.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
