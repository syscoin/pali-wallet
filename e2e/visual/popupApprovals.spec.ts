import { type Locator, type Page, expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const exposed = (locator: Locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    if (
      box.width <= 0 ||
      box.height <= 0 ||
      box.left < 0 ||
      box.top < 0 ||
      box.right > innerWidth ||
      box.bottom > innerHeight
    )
      return false;
    return [
      [box.left + box.width / 2, box.top + 2],
      [box.left + box.width / 2, box.bottom - 2],
      [box.left + 2, box.top + box.height / 2],
      [box.right - 2, box.top + box.height / 2],
    ].every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === element || element.contains(hit));
    });
  });

test('external approval frames and error actions remain reachable in short windows', async ({}, info) => {
  test.setTimeout(120_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    ...(process.env.PALI_TEST_DAPP_EXTENSION_PATH
      ? { extensionPath: process.env.PALI_TEST_DAPP_EXTENSION_PATH }
      : {}),
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'PopupSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let popup: Page | undefined;
  const errors: string[] = [];
  const directory =
    process.env.PALI_POPUP_VISUAL_OUTPUT ||
    path.join(E2E_CONFIG.artifactsDir, 'popup-approvals');
  fs.mkdirSync(directory, { recursive: true });
  const capture = async (page: Page, name: string) => {
    const file = path.join(directory, `${name}.png`);
    await page.screenshot({ path: file, animations: 'disabled' });
    await info.attach(name, { path: file, contentType: 'image/png' });
  };
  try {
    wallet = await PaliWallet.launch('popup-short-approvals', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const state: any = await wallet.page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'getCurrentState' })
    );
    const active =
      state.vault.accounts[state.vault.activeAccount.type][
        state.vault.activeAccount.id
      ];
    const host = 'synthetic-approval-review-account-security.example.invalid';
    const network = state.vaultGlobal.networks.ethereum[1];
    const cases = [
      {
        route: 'connect-wallet',
        data: { chain: 'syscoin', eventName: 'sys_requestAccounts' },
        actions: [en.buttons.cancel, en.buttons.confirm],
      },
      {
        route: 'change-account',
        data: { chain: 'syscoin', eventName: 'sys_requestAccounts' },
        actions: [en.buttons.cancel, en.buttons.change],
      },
      {
        route: 'change-active-connected-account',
        data: {
          connectedAccount: {
            id: active.id,
            address: active.address,
            label: active.label,
            xpub: active.xpub,
            balances: active.balances,
          },
          accountType: state.vault.activeAccount.type,
        },
        actions: [en.buttons.cancel, en.connections.switchAccount],
      },
      {
        route: 'watch-asset',
        data: { eventName: 'wallet_watchAsset' },
        actions: [en.buttons.close],
      },
      {
        route: 'add-EthChain',
        data: {
          eventName: 'wallet_addEthereumChain',
          chainConfig: {
            chainName: 'Synthetic network approval review',
            rpcUrls: ['https://synthetic.invalid'],
            chainId: '0x539',
            nativeCurrency: { name: 'Synthetic', symbol: 'SYN', decimals: 18 },
          },
        },
        actions: [en.buttons.cancel, en.buttons.addNetwork],
      },
      {
        route: 'switch-EthChain',
        data: { eventName: 'wallet_switchEthereumChain', chainId: 1 },
        actions: [en.buttons.reject, en.buttons.confirm],
      },
      {
        route: 'switch-UtxoEvm',
        data: {
          eventName: 'wallet_switchChain',
          newNetwork: network,
          newChainValue: 'ethereum',
        },
        actions: [en.buttons.cancel, en.buttons.change],
      },
      {
        route: 'smart-account-modules',
        data: {
          action: 'install',
          module: {
            address: '0x0000000000000000000000000000000000000003',
            name: 'Synthetic module approval',
          },
        },
        actions: [en.buttons.cancel, en.buttons.confirm],
      },
      {
        route: 'smart-account',
        data: {
          request: {
            label: 'Synthetic account approval',
            authenticator: { id: 'ecdsa' },
          },
        },
        actions: [en.buttons.cancel, en.buttons.confirm],
      },
      {
        route: 'tx/encryptKey',
        data: { eventName: 'eth_getEncryptionPublicKey' },
        actions: [en.buttons.cancel, en.buttons.confirm],
      },
      {
        route: 'tx/decrypt',
        data: {
          eventName: 'eth_decrypt',
          0: 'Synthetic encrypted message for layout only.',
        },
        actions: [en.buttons.cancel, en.buttons.confirm],
      },
    ];
    const page = await wallet.context.newPage();
    popup = page;
    page.on('pageerror', (error) => errors.push(error.message));
    for (const height of [620, 480, 360]) {
      await page.setViewportSize({ width: 400, height });
      for (const fixture of cases) {
        await page.goto(
          `chrome-extension://${wallet.extensionId}/external.html?route=${
            fixture.route
          }&data=${encodeURIComponent(
            JSON.stringify({ host, ...fixture.data })
          )}`
        );
        const layout = page.locator('[data-navigation-scroll="wallet-layout"]');
        await expect(layout).toBeVisible();
        await expect(page.locator('#initial-loader')).toHaveCSS('opacity', '0');
        const bounds = (await layout.boundingBox())!;
        expect
          .soft(
            bounds.y,
            `${fixture.route}: frame starts in viewport at${height}`
          )
          .toBe(0);
        expect
          .soft(
            bounds.height,
            `${fixture.route}: frame matches viewport at${height}`
          )
          .toBe(height);
        await page.mouse.move(200, 180);
        await page.mouse.wheel(0, 3000);
        for (const actionName of fixture.actions) {
          // Icon alt labels contribute to the accessible name on some legacy
          // approval buttons; target the visible action text without dropping
          // the full geometry and hit-target assertions.
          const action = page
            .getByRole('button')
            .filter({ hasText: actionName });
          await expect(action).toHaveCount(1);
          await expect(action).toBeVisible();
          await expect
            .poll(() => exposed(action), {
              message: `${fixture.route}: ${actionName} fully exposed at400x${height}`,
            })
            .toBe(true);
        }
        await capture(
          page,
          `${fixture.route.replaceAll('/', '-')}-400x${height}`
        );
      }
    }
    expect(errors).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
  } catch (error) {
    if (popup) {
      await capture(popup, 'failure');
      await info.attach('failure-ui', {
        body: await popup.locator('body').ariaSnapshot(),
        contentType: 'text/plain',
      });
      await info.attach('page-errors', {
        body: JSON.stringify(errors),
        contentType: 'application/json',
      });
    }
    throw error;
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
