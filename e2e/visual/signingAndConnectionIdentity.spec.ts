import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { getBytes, verifyMessage } from 'ethers';

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
  popupFor,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

async function withWallet(
  name: string,
  run: (wallet: PaliWallet, origin: string) => Promise<void>
) {
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'Qa120RegressionSynthetic!2026',
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
    await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
    await run(wallet, server.url);
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await wallet?.context.close();
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
}

async function connect(wallet: PaliWallet, origin: string) {
  await wallet.page.goto('about:blank');
  const dapp = await wallet.context.newPage();
  await dapp.goto(origin);
  await dapp.waitForFunction(() => Boolean((window as any).pali));
  const result = await approve(
    wallet.context,
    dapp,
    await startRequest(dapp, 'eth_requestAccounts')
  );
  return { dapp, address: result.result[0] as string };
}

async function importSigner(wallet: PaliWallet, label: string) {
  await wallet.gotoRoute('#/settings/account/import');
  await wallet.page.locator('#account-name-input').fill(label);
  // Public deterministic fixture key, never used with real funds.
  await wallet.page.locator('#import-account-identifier').fill('11'.repeat(32));
  await wallet.page
    .getByRole('button', { name: en.buttons.import, exact: true })
    .click();
  await expect(
    wallet.page.getByText(en.settings.accountImported, { exact: true })
  ).toBeVisible();
  await wallet.ensureOnHome();
}

async function capture(page: Page, info: TestInfo, name: string) {
  const file = info.outputPath(`${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  await info.attach(name, { path: file, contentType: 'image/png' });
}

for (const method of ['eth_signTypedData_v3', 'eth_signTypedData_v4']) {
  test(`${method} rejects malformed data before approval and retains a working Data tab`, async ({}, info) => {
    test.setTimeout(120000);
    await withWallet(`qa120-${method}`, async (wallet, origin) => {
      const { dapp, address } = await connect(wallet, origin);
      const errors: string[] = [];
      wallet.context.on('page', (page) =>
        page.on('pageerror', (error) => errors.push(error.message))
      );
      const rejected = await settle(
        dapp,
        await startRequest(dapp, method, [address, 'not-json'])
      );
      expect(rejected.error?.code).toBe(-32602);
      expect(
        wallet.context
          .pages()
          .filter((page) => page.url().includes('/external'))
      ).toHaveLength(0);
      const data = {
        types: {
          EIP712Domain: [],
          Test: [{ name: 'value', type: 'uint256' }],
        },
        primaryType: 'Test',
        domain: {},
        message: { value: '1' },
      };
      const id = await startRequest(dapp, method, [
        address,
        JSON.stringify(data),
      ]);
      const popup = await popupFor(wallet.context, dapp, id);
      await popup.getByRole('button', { name: 'Data', exact: true }).click();
      await expect(
        popup.getByText('Structured Data', { exact: true })
      ).toBeVisible();
      await capture(popup, info, `${method}-valid-data`);
      const canceled = await dismissRejectedApproval({
        click: () =>
          popup
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .click(),
        isClosed: () => popup.isClosed(),
        settle: () => settle(dapp, id),
      });
      expect(canceled.error?.code).toBe(4001);
      expect(errors).toEqual([]);
    });
  });
}

test('personal_sign handles canonical address-shaped messages and unambiguous legacy order', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet('qa120-personal-sign', async (wallet, origin) => {
    const { dapp, address } = await connect(wallet, origin);
    for (const { name, message, params } of [
      {
        name: 'canonical-20-byte-message',
        message: `0x${'22'.repeat(20)}`,
        params: [`0x${'22'.repeat(20)}`, address],
      },
      {
        name: 'legacy-21-byte-message',
        message: `0x${'22'.repeat(21)}`,
        params: [address, `0x${'22'.repeat(21)}`],
      },
    ]) {
      const result = await approve(
        wallet.context,
        dapp,
        await startRequest(dapp, 'personal_sign', params),
        (popup) => capture(popup, info, name)
      );
      expect(
        verifyMessage(getBytes(message), result.result).toLowerCase()
      ).toBe(address.toLowerCase());
    }
  });
});

test('personal_sign treats another owned address as message bytes, not signer selection', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet('qa120-personal-owned-message', async (wallet, origin) => {
    const originalAddress = await wallet.page.evaluate(
      () =>
        new Promise<string>((resolve) =>
          chrome.runtime.sendMessage({ type: 'getCurrentState' }, (state) => {
            const { type, id } = state.vault.activeAccount;
            resolve(state.vault.accounts[type][id].address);
          })
        )
    );
    const label = 'QA120 signing account';
    await importSigner(wallet, label);
    const { dapp, address } = await connect(wallet, origin);
    expect(originalAddress.toLowerCase()).not.toBe(address.toLowerCase());
    const id = await startRequest(dapp, 'personal_sign', [
      originalAddress,
      address,
    ]);
    const popup = await popupFor(wallet.context, dapp, id);
    await expect(popup.getByText(label, { exact: true })).toBeVisible();
    await capture(popup, info, 'owned-address-as-message');
    await popup
      .getByRole('button', { name: en.buttons.confirm, exact: true })
      .click();
    const signed = await settle(dapp, id);
    expect(signed.error).toBeUndefined();
    expect(
      verifyMessage(getBytes(originalAddress), signed.result).toLowerCase()
    ).toBe(address.toLowerCase());
  });
});

test('long connected-account labels retain visible edit and disconnect controls', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet('qa120-connected-label', async (wallet, origin) => {
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
    await connect(wallet, origin);
    await importSigner(wallet, 'QA120 other account');
    await wallet.gotoRoute('#/settings/networks/connected-sites');
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(
        page.getByText(`Connected to: ${label}`, { exact: true })
      ).toBeVisible();
      const button = page.getByRole('button', {
        name: en.settings.editConnection,
        exact: true,
      });
      const exposed = await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2
        );
        return (
          rect.left >= 0 &&
          rect.right <= innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight &&
          !!hit &&
          (hit === element || element.contains(hit))
        );
      });
      expect(exposed).toBe(true);
      await capture(page, info, `connected-label-${viewport.width}`);
    }
    await page
      .getByRole('button', { name: en.settings.editConnection, exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: en.settings.deleteConnected, exact: true })
      .click();
    await expect(
      page.getByText('No sites are connected to Pali Wallet', { exact: true })
    ).toBeVisible();
  });
});

test('network typeahead preserves spaces in group-prefixed custom names', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet('qa120-network-typeahead', async (wallet, origin) => {
    const page = wallet.page;
    // Configure only this disposable profile through the real controller. The
    // custom network is not selected; keyboard navigation is the behavior under
    // test, not RPC validation or network switching.
    await page.evaluate(
      (url) =>
        new Promise<void>((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: 'CONTROLLER_ACTION',
              data: {
                methods: ['wallet', 'addCustomRpc'],
                params: [
                  {
                    kind: 'ethereum',
                    chainId: 31337,
                    slip44: 60,
                    currency: 'TST',
                    label: 'EVM Custom',
                    url,
                  },
                ],
              },
            },
            (response) => {
              if (chrome.runtime.lastError || response?.error)
                reject(new Error('Synthetic custom-network setup failed'));
              else resolve();
            }
          );
        }),
      origin
    );
    await page.setViewportSize({ width: 320, height: 360 });
    const trigger = page.locator('button[aria-haspopup="menu"]').first();
    await trigger.click();
    const menu = page.getByRole('menu');
    const group = menu.getByRole('menuitem', {
      name: en.networkMenu.evmNetworks,
      exact: true,
    });
    if ((await group.getAttribute('aria-expanded')) !== 'true')
      await group.click();
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    const target = menu.getByRole('menuitem', {
      name: 'EVM Custom',
      exact: true,
    });
    await expect(target).toBeVisible();
    await menu.press('Home');
    for (const key of ['E', 'V', 'M', 'Space', 'C']) await menu.press(key);
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toHaveAttribute(
      'aria-activedescendant',
      (await target.getAttribute('id'))!
    );
    await capture(page, info, 'network-prefix-typeahead');
    await menu.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
