import { expect, test } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('Send keeps long account identities readable and copyable in narrow windows', async ({}, info) => {
  test.setTimeout(120_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SendIdentitySynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('send-identity-qa', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const fixture = createIsolatedVaultFixture();
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const page = wallet.page;
    const label = 'LongUnbrokenAccountLabelForWalletQualityAssurance';
    for (const network of [
      { label: 'Syscoin Testnet', kind: 'UTXO' as const, route: 'sys' },
      { label: 'Syscoin NEVM Testnet', kind: 'EVM' as const, route: 'eth' },
    ]) {
      await wallet.ensureOnHome();
      await page.setViewportSize({ width: 400, height: 620 });
      await wallet.switchNetwork(network.label, network.kind);
      await wallet.ensureOnHome();
      await wallet.gotoRoute('#/settings/manage-accounts');
      await page
        .locator('[data-navigation-scroll="settings-manage-accounts"] li')
        .first()
        .getByRole('button')
        .first()
        .click();
      await page
        .getByPlaceholder(en.settings.accountLabel)
        .fill(`${label}${network.route}`);
      await page
        .getByRole('button', { name: en.buttons.save, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/settings\/manage-accounts/);
      await wallet.ensureOnHome();
      await page.locator('#send-btn').click();
      await expect(page).toHaveURL(new RegExp(`#/send/${network.route}$`));
      // The route URL can update before the scoped form finishes replacing
      // its provisional account. Wait for the actual selected identity, not a
      // label in a form that is about to unmount when its account key settles.
      const expectedAddress =
        network.route === 'sys'
          ? fixture.utxo.userAddress
          : fixture.evmAddresses[0];
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              new Promise((resolve) => {
                chrome.runtime.sendMessage(
                  {
                    type: 'CONTROLLER_ACTION',
                    data: { methods: ['wallet', 'getState'], params: [] },
                  },
                  ({ vault, vaultGlobal }) => {
                    const account =
                      vault.accounts[vault.activeAccount.type][
                        vault.activeAccount.id
                      ];
                    resolve({
                      address: account.address,
                      changing:
                        vaultGlobal.isSwitchingAccount ||
                        ['switching', 'connecting'].includes(
                          vaultGlobal.networkStatus
                        ),
                    });
                  }
                );
              })
          )
        )
        .toEqual({ address: expectedAddress, changing: false });
      await expect(
        page.locator(
          '[data-navigation-scroll="wallet-layout"] [aria-busy="true"]'
        )
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: en.buttons.copy, exact: true })
      ).toHaveText(
        `${expectedAddress.slice(0, 4)}...${expectedAddress.slice(-4)}`
      );
      await page.evaluate(() => {
        (window as any).__identityCopies = [];
        (window as any).__explorerUrls = [];
        window.open = ((url: unknown) => {
          (window as any).__explorerUrls.push(String(url));
          return null;
        }) as typeof window.open;
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (value: string) =>
              (window as any).__identityCopies.push(value),
          },
        });
      });
      for (const viewport of [
        { width: 320, height: 360 },
        { width: 400, height: 360 },
      ]) {
        await page.setViewportSize(viewport);
        const accountLabel = page.getByText(`${label}${network.route}`, {
          exact: true,
        });
        await accountLabel.scrollIntoViewIfNeeded();
        const bounds = await accountLabel.boundingBox();
        await info.attach(`${network.route}-${viewport.width}-identity`, {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
        expect
          .soft(bounds!.x, 'Account label left edge')
          .toBeGreaterThanOrEqual(0);
        expect
          .soft(bounds!.x + bounds!.width, 'Account label right edge')
          .toBeLessThanOrEqual(viewport.width);
        expect
          .soft(
            await accountLabel.evaluate(
              (element) => element.scrollWidth <= element.clientWidth
            ),
            'Full account label wraps rather than being clipped'
          )
          .toBe(true);
        const copy = page.getByRole('button', {
          name: en.buttons.copy,
          exact: true,
        });
        await expect.soft(copy).toHaveCount(1);
        // Ordinary keyboard traversal must reach and activate Copy; focus()
        // would conceal the original non-focusable div regression.
        for (let step = 0; step < 24; step++) {
          if (
            await copy.evaluate((element) => document.activeElement === element)
          )
            break;
          await page.keyboard.press('Tab');
        }
        await expect(copy).toBeFocused();
        const copyBounds = (await copy.boundingBox())!;
        expect(copyBounds.height).toBeGreaterThanOrEqual(44);
        expect(copyBounds.y).toBeGreaterThanOrEqual(0);
        expect(copyBounds.y + copyBounds.height).toBeLessThanOrEqual(
          viewport.height
        );
        await page.keyboard.press('Enter');
        const explorer = page.getByRole('button', {
          name: en.home.viewAccountOnExplorer,
          exact: true,
        });
        await expect.soft(explorer).toHaveCount(1);
        for (let step = 0; step < 24; step++) {
          if (
            await explorer.evaluate(
              (element) => document.activeElement === element
            )
          )
            break;
          await page.keyboard.press('Shift+Tab');
        }
        await expect(explorer).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`#/send/${network.route}$`));
      }
      const explorerUrls: string[] = await page.evaluate(
        () => (window as any).__explorerUrls
      );
      expect(explorerUrls).toHaveLength(2);
      for (const url of explorerUrls)
        expect(new URL(url).pathname).toBe(
          network.route === 'sys'
            ? `/xpub/${fixture.utxo.userXpub}`
            : `/address/${fixture.evmAddresses[0]}`
        );
      expect(
        await page.evaluate(() => (window as any).__identityCopies)
      ).toEqual([
        network.route === 'sys'
          ? fixture.utxo.userAddress
          : fixture.evmAddresses[0],
        network.route === 'sys'
          ? fixture.utxo.userAddress
          : fixture.evmAddresses[0],
      ]);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
    }
    expect(routes.deniedWrites).toEqual([]);
    if (test.info().errors.length === 0) status = 'passed';
  } catch (error) {
    if (wallet)
      await info
        .attach('failure', {
          body: await wallet.page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        })
        .catch(() => undefined);
    throw error;
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      try {
        await server.close();
      } finally {
        Object.assign(E2E_CONFIG, before);
      }
    }
  }
});
