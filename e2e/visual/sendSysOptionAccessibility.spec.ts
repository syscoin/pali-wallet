import { expect, test, type Locator, type Page } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createSptFixture,
  installSptFixtureRoutes,
  SPT_SYMBOL,
} from '../harness/sptFixture';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const tabTo = async (page: Page, target: Locator) => {
  for (let index = 0; index < 40; index += 1) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};

for (const asset of ['native', 'spt'] as const) {
  test(`UTXO send ${asset} option is named and preserves keyboard and pointer toggles`, async ({}, info) => {
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'SendOptionSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const observations: Record<string, unknown> = {};
    let deniedWrites: string[] = [];
    try {
      wallet = await PaliWallet.launch(`send-option-${asset}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      const routes = await installSptFixtureRoutes(
        wallet.context,
        createSptFixture(),
        server.url
      );
      deniedWrites = routes.deniedWrites;
      const page = wallet.page;
      await wallet.step(
        `${asset} open the ordinary Send form and select its asset`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet!.ensureOnHome();
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.home.importToken, exact: true })
            .click();
          const importToken = page.getByRole('button', {
            name: `Import ${SPT_SYMBOL} token`,
            exact: true,
          });
          await importToken.click();
          await expect(importToken).toBeDisabled();
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await wallet!.ensureOnHome();
          await page.locator('#send-btn').click();
          await expect(page).toHaveURL(/#\/send\/sys$/);
          if (asset === 'spt') {
            await page
              .getByRole('button', { name: 'tsys', exact: true })
              .and(page.locator('[aria-haspopup="menu"]'))
              .click();
            await page
              .getByRole('menuitem')
              .filter({ hasText: SPT_SYMBOL })
              .click();
          }
        }
      );
      await wallet.step(
        `${asset} retain checked state and identify the option without submitting`,
        async (capture) => {
          try {
            const option = page.getByRole('switch');
            const initial = asset === 'native';
            await expect(option).toHaveCount(1);
            await expect(option).toHaveAttribute(
              'aria-checked',
              String(initial)
            );
            await tabTo(page, option);
            await expect(option).toBeFocused();
            await page.keyboard.press('Space');
            await expect(option).toHaveAttribute(
              'aria-checked',
              String(!initial)
            );
            await page.keyboard.press('Space');
            await expect(option).toHaveAttribute(
              'aria-checked',
              String(initial)
            );
            await option.click();
            await expect(option).toHaveAttribute(
              'aria-checked',
              String(!initial)
            );
            await option.click();
            await expect(option).toHaveAttribute(
              'aria-checked',
              String(initial)
            );
            observations.keyboardAndPointerControlsPassed = true;
            observations.option = {
              label: await option.getAttribute('aria-label'),
              labelledBy: await option.getAttribute('aria-labelledby'),
              text: await option.textContent(),
              checked: await option.getAttribute('aria-checked'),
            };
            expect(routes.deniedWrites).toEqual([]);
            await expect(page).toHaveURL(/#\/send\/sys$/);
            expect(
              wallet!.context.pages().some((p) => p.url().includes('/external'))
            ).toBe(false);
            await expect(option).toHaveAccessibleName(
              asset === 'native' ? 'RBF' : 'Z-DAG'
            );
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
      status = 'passed';
    } finally {
      await info.attach('send-option-accessibility', {
        contentType: 'application/json',
        body: JSON.stringify({
          asset,
          status,
          observations,
          deniedWrites,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          nextOrConfirmClicked: false,
          syntheticWalletOnly: true,
        }),
      });
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  });
}
