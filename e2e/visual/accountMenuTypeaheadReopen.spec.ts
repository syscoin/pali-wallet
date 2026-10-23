import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
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

const BETA_LABEL = 'Beta typeahead account';

const publicAccounts = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const { activeAccount, accounts, activeNetwork } = state.vault;
    const storageKey = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const stored = await chrome.storage.local.get(storageKey);
    const project = (value: any) =>
      Object.values(value?.HDAccount || {}).map((account: any) => ({
        id: account.id,
        address: account.address,
        label: account.label,
      }));
    return {
      active: {
        ...activeAccount,
        address: accounts[activeAccount.type][activeAccount.id].address,
        label: accounts[activeAccount.type][activeAccount.id].label,
      },
      network: {
        chainId: activeNetwork.chainId,
        kind: activeNetwork.kind,
        url: activeNetwork.url,
      },
      switching: !!state.vaultGlobal.isSwitchingAccount,
      storageKey,
      liveAccounts: project(accounts),
      savedAccounts: project(stored[storageKey]?.accounts),
    };
  });

const activeItem = async (menu: Locator, item: Locator) => {
  const activeId = await menu.getAttribute('aria-activedescendant');
  return !!activeId && activeId === (await item.getAttribute('id'));
};

const geometry = (item: Locator) =>
  item.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const hit = (x: number, y: number) => {
      const target = document.elementFromPoint(x, y);
      return target === element || (!!target && element.contains(target));
    };
    return {
      width: bounds.width,
      height: bounds.height,
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      viewport: { width: innerWidth, height: innerHeight },
      exposed: [
        [bounds.left + 2, bounds.top + bounds.height / 2],
        [bounds.right - 2, bounds.top + bounds.height / 2],
        [bounds.left + bounds.width / 2, bounds.top + 2],
        [bounds.left + bounds.width / 2, bounds.bottom - 2],
      ].every(([x, y]) => hit(x, y)),
    };
  });

const expectExposed = async (item: Locator) => {
  await expect
    .poll(async () => {
      const value = await geometry(item);
      return (
        value.width >= 44 &&
        value.height >= 38 &&
        value.left >= 0 &&
        value.top >= 0 &&
        value.right <= value.viewport.width &&
        value.bottom <= value.viewport.height &&
        value.exposed
      );
    })
    .toBe(true);
  return geometry(item);
};

const tabTo = async (page: Page, control: Locator) => {
  for (let index = 0; index < 35; index += 1) {
    if (await control.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
};

for (const dismissal of ['Escape', 'Tab'] as const) {
  test(`account menu starts fresh typeahead after ${dismissal} and pointer reopening`, async ({}, info) => {
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
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const observations: Record<string, unknown> = {};
    const failedRequests: Array<{ method: string; url: string }> = [];
    const forbiddenRequests: string[] = [];
    let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'AccountTypeaheadSynthetic!2026',
        rpcUrl: server.url,
      });
      wallet = await PaliWallet.launch(
        `account-menu-typeahead-${dismissal.toLowerCase()}`,
        {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        }
      );
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          failedRequests.push({ method: request.method(), url: request.url() });
      });
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
          // Ordinary GET requests have no JSON body.
        }
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      const page = wallet.page;
      const trigger = page.getByRole('button', {
        name: en.generalMenu.generalOptions,
        exact: true,
      });
      const menu = page.getByRole('menu');
      let baseline: Awaited<ReturnType<typeof publicAccounts>>;
      let original: Awaited<ReturnType<typeof publicAccounts>>['active'];
      const accountItem = (account: { address: string; label: string }) =>
        menu.getByRole('menuitem', {
          name: `${account.label} (${account.address})`,
          exact: true,
        });
      const betaItem = () =>
        accountItem({ label: BETA_LABEL, address: fixture.secondUtxo.address });
      const expectSelection = async (
        id: number,
        label: string,
        address: string
      ) => {
        await expect
          .poll(() => publicAccounts(page))
          .toMatchObject({
            active: { id, type: 'HDAccount', label, address },
            switching: false,
          });
        const state = await publicAccounts(page);
        expect(state.network).toEqual(baseline.network);
        expect(state.liveAccounts).toEqual(baseline.liveAccounts);
        expect(state.savedAccounts).toEqual(baseline.savedAccounts);
        return state;
      };

      await wallet.step(
        `${dismissal}: create the second account through the normal account menu`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet!.ensureOnHome();
          original = (await publicAccounts(page)).active;
          expect(original).toMatchObject({
            id: 0,
            type: 'HDAccount',
            address: fixture.utxo.userAddress,
          });
          await trigger.click();
          await menu
            .getByRole('menuitem', {
              name: en.accountMenu.createNewAccount,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/account\/new$/);
          await page.locator('#account-name-input').fill(BETA_LABEL);
          await page.locator('#create-btn').click();
          await page.getByRole('button', { name: /^ok$/i }).click();
          await wallet!.ensureOnHome();
          await expect
            .poll(() => publicAccounts(page))
            .toMatchObject({
              active: {
                id: 1,
                type: 'HDAccount',
                label: BETA_LABEL,
                address: fixture.secondUtxo.address,
              },
              switching: false,
            });
          baseline = await publicAccounts(page);
          expect(baseline.storageKey).toBe('state-vault-1');
          expect(baseline.liveAccounts).toEqual([
            {
              id: original.id,
              address: original.address,
              label: original.label,
            },
            { id: 1, address: fixture.secondUtxo.address, label: BETA_LABEL },
          ]);
          await expect
            .poll(async () => (await publicAccounts(page)).savedAccounts)
            .toEqual(baseline.liveAccounts);
          baseline = await publicAccounts(page);
          observations.created = baseline;
        }
      );

      await wallet.step(
        `${dismissal}: select the original account with fresh pointer-opened typeahead`,
        async () => {
          await trigger.click();
          await expect(menu).toBeFocused();
          await page.keyboard.type(original.label);
          await expect
            .poll(() => activeItem(menu, accountItem(original)))
            .toBe(true);
          const exposed = await expectExposed(accountItem(original));
          const activeId = await menu.getAttribute('aria-activedescendant');
          await page.keyboard.press('Enter');
          observations.fresh = {
            activeId,
            exposed,
            state: await expectSelection(
              original.id,
              original.label,
              original.address
            ),
          };
          await expect(menu).toBeHidden();
          // GoToItem on an ordinary keyboard opening clears the completed
          // control search before the separate dismissal regression below.
          await expect(trigger).toBeFocused();
          await page.keyboard.press('ArrowDown');
          await expect
            .poll(() => activeItem(menu, accountItem(original)))
            .toBe(true);
          await page.keyboard.press('Escape');
          await expect(menu).toBeHidden();
        }
      );

      await wallet.step(
        `${dismissal}: discard the old query before pointer reopening and selecting Beta`,
        async () => {
          const before = await publicAccounts(page);
          await trigger.click();
          await expect(menu).toBeFocused();
          await page.keyboard.type(original.label);
          await expect
            .poll(() => activeItem(menu, accountItem(original)))
            .toBe(true);
          await page.keyboard.press(dismissal);
          await expect(menu).toBeHidden();
          expect(await publicAccounts(page)).toEqual(before);
          // Deliberately cross Headless UI's existing 350ms search timeout; this
          // is the reproduced dismissal condition, not a retry or larger budget.
          await page.waitForTimeout(400);
          await trigger.click();
          await expect(menu).toBeFocused();
          await page.keyboard.type('Beta');
          await expect.poll(() => activeItem(menu, betaItem())).toBe(true);
          const exposed = await expectExposed(betaItem());
          const activeId = await menu.getAttribute('aria-activedescendant');
          const itemId = await betaItem().getAttribute('id');
          await info.attach(
            `account-menu-typeahead-${dismissal.toLowerCase()}-reopened`,
            {
              body: await page.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            }
          );
          await page.keyboard.press('Enter');
          observations.reopened = {
            dismissal,
            delayMs: 400,
            activeId,
            itemId,
            exposed,
            before,
            state: await expectSelection(
              1,
              BETA_LABEL,
              fixture.secondUtxo.address
            ),
          };
          await expect(menu).toBeHidden();
        }
      );

      await wallet.step(
        `${dismissal}: preserve keyboard navigation and direct selection in a narrow window`,
        async () => {
          await page.setViewportSize({ width: 320, height: 360 });
          await page.mouse.move(0, 0);
          await tabTo(page, trigger);
          await page.keyboard.press('ArrowDown');
          await expect
            .poll(() => activeItem(menu, accountItem(original)))
            .toBe(true);
          const first = await expectExposed(accountItem(original));
          await page.keyboard.press('ArrowDown');
          const copy = menu.getByRole('menuitem', {
            name: `${en.buttons.copy}: ${original.label} (${original.address})`,
            exact: true,
          });
          await expect.poll(() => activeItem(menu, copy)).toBe(true);
          const copyExposed = await expectExposed(copy);
          await page.keyboard.press('ArrowUp');
          await expect
            .poll(() => activeItem(menu, accountItem(original)))
            .toBe(true);
          await page.keyboard.press('Home');
          await expect
            .poll(() => activeItem(menu, accountItem(original)))
            .toBe(true);
          await info.attach(
            `account-menu-typeahead-${dismissal.toLowerCase()}-320x360`,
            {
              body: await page.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            }
          );
          await page.keyboard.press('Escape');
          await expect(menu).toBeHidden();
          await trigger.click();
          await expectExposed(accountItem(original));
          await accountItem(original).click();
          const state = await expectSelection(
            original.id,
            original.label,
            original.address
          );
          observations.keyboard = {
            viewport: { width: 320, height: 360 },
            first,
            copy: copyExposed,
            state,
          };
          await expect(menu).toBeHidden();
          await page.setViewportSize({ width: 400, height: 620 });
        }
      );
      expect(routes.deniedWrites).toEqual([]);
      expect(forbiddenRequests).toEqual([]);
      expect(extensionEvidence()).toEqual(runtime);
      status = 'passed';
    } finally {
      try {
        await info.attach('account-menu-typeahead-reopen-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            dismissal,
            runtime,
            observations,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex'),
            fixtureReads: routes?.reads || [],
            deniedWrites: routes?.deniedWrites || [],
            forbiddenRequests,
            failedRequests,
            proxyDeniedRequests: server?.blocked || [],
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApiReplaced: false,
            signingOrBroadcastRequested: false,
            scope:
              'Two real HD accounts only; no large-list or clipboard-execution claim. Normal menu selection is session state; only account records are asserted durable.',
          }),
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
}
