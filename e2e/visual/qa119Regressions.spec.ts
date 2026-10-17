import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { recoverAddress, solidityPackedKeccak256 } from 'ethers';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { approve, settle, startRequest } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

async function withWallet(
  name: string,
  run: (wallet: PaliWallet, origin: string) => Promise<void>
) {
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'Qa119SyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch(name, {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    await run(wallet, server.url);
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await wallet?.context.close();
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
}

async function exposed(locator: Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2
    );
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left >= 0 &&
      rect.top >= 0 &&
      rect.right <= innerWidth &&
      rect.bottom <= innerHeight &&
      !!hit &&
      (element === hit || element.contains(hit))
    );
  });
}

async function capture(page: Page, info: TestInfo, name: string) {
  const file = info.outputPath(`${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  await info.attach(name, { path: file, contentType: 'image/png' });
}

async function keyboardItem(menu: Locator, name: string) {
  const target = menu.getByRole('menuitem', { name, exact: true });
  await expect(target).toBeVisible();
  const targetId = await target.getAttribute('id');
  const ids = await menu
    .getByRole('menuitem')
    .evaluateAll((items) =>
      items
        .filter((item) => item.getAttribute('aria-disabled') !== 'true')
        .map((item) => item.id)
    );
  const index = ids.indexOf(targetId!);
  expect(index).toBeGreaterThanOrEqual(0);
  await menu.press('Home');
  await expect(menu).toHaveAttribute('aria-activedescendant', ids[0]);
  for (let position = 1; position <= index; position++) {
    await menu.press('ArrowDown');
    await expect(menu).toHaveAttribute('aria-activedescendant', ids[position]);
  }
  await expect(menu).toHaveAttribute('aria-activedescendant', targetId!);
  return target;
}

test('long home account labels retain full identity and exposed controls in small windows', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet('qa119-header-regression', async (wallet) => {
    const page = wallet.page;
    const label = 'A'.repeat(80);
    await page
      .locator('[id="active-account-label items-center"]')
      .getByRole('button', { name: en.buttons.edit, exact: true })
      .click();
    await page.getByPlaceholder(en.settings.accountLabel).fill(label);
    await page
      .getByRole('button', { name: en.buttons.save, exact: true })
      .click();
    await expect(page).toHaveURL(/#\/home/);
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      const name = page.getByTitle(label, { exact: true });
      await expect(name).toHaveText(label);
      const bounds = await name.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(
        await name.evaluate((element) => getComputedStyle(element).textOverflow)
      ).toBe('ellipsis');
      const edit = page
        .locator('[id="active-account-label items-center"]')
        .getByRole('button', { name: en.buttons.edit, exact: true });
      const copy = page
        .locator('#copy-address-btn')
        .locator('xpath=ancestor::button[1]');
      await expect.poll(() => exposed(edit)).toBe(true);
      await expect.poll(() => exposed(copy)).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBe(viewport.width);
      await capture(
        page,
        info,
        `home-long-label-${viewport.width}x${viewport.height}`
      );
    }
  });
});

test('both default-wallet choices remain unobscured beside Close in small windows', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet('qa119-default-wallet-regression', async (wallet) => {
    const page = wallet.page;
    for (const label of [
      'Set Metamask as default wallet',
      'Set Pali as default wallet',
    ]) {
      await wallet.gotoRoute('#/settings/remove-eth');
      const action = page.getByRole('button', { name: label, exact: true });
      for (const viewport of [
        { width: 320, height: 360 },
        { width: 400, height: 480 },
      ]) {
        await page.setViewportSize(viewport);
        const close = page
          .locator('[data-page-action-footer]')
          .getByRole('button', { name: en.buttons.close, exact: true });
        await expect.poll(() => exposed(action)).toBe(true);
        await expect.poll(() => exposed(close)).toBe(true);
        expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await capture(
          page,
          info,
          `default-${label.includes('Metamask') ? 'metamask' : 'pali'}-${
            viewport.width
          }x${viewport.height}`
        );
      }
      // Only this disposable browser's provider preference is changed.
      await action.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await wallet.ensureOnHome();
    }
  });
});

test('header network families and choices are keyboard-operable in a small window', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet('qa119-network-regression', async (wallet) => {
    const page = wallet.page;
    await page.setViewportSize({ width: 320, height: 360 });
    for (const { group, label } of [
      { group: 'UTXO Networks', label: 'Syscoin Testnet' },
      { group: 'EVM Networks', label: 'Syscoin NEVM Testnet' },
    ]) {
      const trigger = page.locator('button[aria-haspopup="menu"]').first();
      await trigger.focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu');
      const family = await keyboardItem(menu, group);
      if ((await family.getAttribute('aria-expanded')) !== 'true')
        await menu.press('Enter');
      await expect(family).toHaveAttribute('aria-expanded', 'true');
      await expect(menu).toBeVisible();
      await keyboardItem(menu, label);
      await capture(
        page,
        info,
        `keyboard-${group.split(' ')[0].toLowerCase()}`
      );
      await menu.press('Enter');
      await expect(menu).toBeHidden();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              new Promise((resolve) =>
                chrome.runtime.sendMessage(
                  { type: 'getCurrentState' },
                  (state) =>
                    resolve({
                      label: state.vault.activeNetwork.label,
                      status: state.vaultGlobal.networkStatus,
                      switching: state.vaultGlobal.isSwitchingAccount,
                    })
                )
              )
          )
        )
        .toEqual({ label, status: 'idle', switching: false });
      await wallet.ensureOnHome();
      await expect.poll(() => wallet.getActiveNetworkLabel()).toBe(label);
    }
    const trigger = page.locator('button[aria-haspopup="menu"]').first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menu').press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test('both legacy typed-data parameter orders render and sign the exact reviewed fields', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet(
    'qa119-legacy-signing-regression',
    async (wallet, origin) => {
      await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
      await wallet.page.goto('about:blank');
      const dapp = await wallet.context.newPage();
      await dapp.goto(origin);
      await dapp.waitForFunction(() => Boolean((window as any).pali));
      const connection = await approve(
        wallet.context,
        dapp,
        await startRequest(dapp, 'eth_requestAccounts')
      );
      const address = connection.result[0];
      const errors: string[] = [];
      wallet.context.on('page', (page) =>
        page.on('pageerror', (error) => errors.push(error.message))
      );
      const fields = [
        { name: 'Message', type: 'string', value: 'Exact message 日本語' },
        { name: 'Amount', type: 'uint256', value: '9007199254740993' },
        { name: 'Enabled', type: 'bool', value: false },
      ];
      // Independently compute the V1 schema/value hash for these string,
      // uint256 and bool fixtures using the existing ethers dependency.
      const digest = solidityPackedKeccak256(
        ['bytes32', 'bytes32'],
        [
          solidityPackedKeccak256(
            fields.map(() => 'string'),
            fields.map((field) => `${field.type} ${field.name}`)
          ),
          solidityPackedKeccak256(
            fields.map((field) => field.type),
            fields.map((field) => field.value)
          ),
        ]
      );
      expect(digest).toBe(
        '0x1f3357f352321f92b8c28dc234ef6c83c8c96708614332abc3a2e710a55878d4'
      );
      for (const addressFirst of [true, false]) {
        const popup = wallet.context.waitForEvent('page');
        const id = await startRequest(
          dapp,
          'eth_signTypedData',
          addressFirst ? [address, fields] : [fields, address]
        );
        const approval = await popup;
        await expect(
          approval.getByText('Exact message 日本語', { exact: true })
        ).toBeVisible();
        await expect(
          approval.getByText('9007199254740993', { exact: true })
        ).toBeVisible();
        await expect(
          approval.getByText('false', { exact: true })
        ).toBeVisible();
        await capture(
          approval,
          info,
          `legacy-${addressFirst ? 'address' : 'payload'}-first`
        );
        await approval
          .getByRole('button', { name: en.buttons.confirm, exact: true })
          .click();
        const signed = await settle(dapp, id);
        expect(signed.error).toBeUndefined();
        expect(recoverAddress(digest, signed.result).toLowerCase()).toBe(
          address.toLowerCase()
        );
      }
      const popup = wallet.context.waitForEvent('page');
      const cancelledId = await startRequest(dapp, 'eth_signTypedData', [
        address,
        fields,
      ]);
      const approval = await popup;
      await approval
        .getByRole('button', { name: en.buttons.cancel, exact: true })
        .click();
      expect((await settle(dapp, cancelledId)).error).toBeTruthy();
      expect(errors).toEqual([]);
    }
  );
});

test('connected-site attribution distinguishes matching IDs across actual account types', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet(
    'qa119-connected-account-regression',
    async (wallet, origin) => {
      await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
      const page = wallet.page;
      const originalLabel = await page
        .locator('[id="active-account-label items-center"] > span')
        .innerText();
      await page.goto('about:blank');
      const dapp = await wallet.context.newPage();
      await dapp.goto(origin);
      await dapp.waitForFunction(() => Boolean((window as any).pali));
      const connection = await approve(
        wallet.context,
        dapp,
        await startRequest(dapp, 'eth_requestAccounts')
      );
      const address = connection.result[0];
      await wallet.gotoRoute('#/settings/account/import');
      await page.locator('#account-name-input').fill('QA imported signer');
      // A public deterministic test key, never used with real funds.
      await page.locator('#import-account-identifier').fill('11'.repeat(32));
      await page
        .getByRole('button', { name: en.buttons.import, exact: true })
        .click();
      await expect(
        page.getByText(en.settings.accountImported, { exact: true })
      ).toBeVisible();
      await wallet.ensureOnHome();
      const scope = await page.evaluate(
        () =>
          new Promise((resolve) =>
            chrome.runtime.sendMessage({ type: 'getCurrentState' }, (state) =>
              resolve({
                active: state.vault.activeAccount,
                connections: Object.values(state.dapp.dapps).map(
                  (entry: any) => ({
                    accountId: entry.accountId,
                    accountType: entry.accountType,
                  })
                ),
              })
            )
          )
      );
      expect(scope).toEqual({
        active: { id: 0, type: 'Imported' },
        connections: [{ accountId: 0, accountType: 'HDAccount' }],
      });
      await wallet.gotoRoute('#/settings/networks/connected-sites');
      await expect(
        page.getByText(`Connected to: ${originalLabel}`, { exact: true })
      ).toBeVisible();
      await capture(page, info, 'connected-account-type-attribution');
      await page
        .getByRole('button', { name: en.settings.editConnection, exact: true })
        .click();
      const dialog = page.getByRole('dialog', {
        name: en.settings.editConnection,
      });
      await expect(
        dialog.getByText(originalLabel, { exact: true })
      ).toBeVisible();
      expect(await dialog.innerText()).not.toContain('QA imported signer');
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      await page.keyboard.press('Escape');
    }
  );
});
