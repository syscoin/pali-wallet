import { expect, test } from '@playwright/test';

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

test('native amounts use exact decimal units while retaining the entered draft', async ({}, info) => {
  test.setTimeout(120_000);
  const previous = { ...E2E_CONFIG };
  const fixture = createUtxoFixture('1000000000');
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NativeAmountSyntheticOnly!2026',
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('native-send-amounts', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const page = wallet.page;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await wallet.step('import a disposable fixture wallet', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
      await wallet!.ensureOnHome();
      await expect(page.locator('#home-balance')).toHaveText('10');
    });
    await wallet.step('open ordinary native Send', async () => {
      await page.locator('#send-btn').click();
      await expect(page).toHaveURL(/#\/send\/sys$/);
      await expect
        .poll(async () => Number(await page.locator('#fee-input').inputValue()))
        .toBeGreaterThan(0);
      await page
        .getByPlaceholder(en.send.receiver, { exact: true })
        .fill(fixture.recipientAddress);
    });
    const amounts = [
      ['0.0001', '0.0001'],
      ['1e-4', '0.0001'],
      ['1e0', '1'],
      ['1e-2', '0.01'],
      ['1.23456789', '1.23456789'],
    ];
    for (const [entered, canonical] of amounts) {
      await wallet.step(
        `prepare ${entered} as exact ${canonical} SYS`,
        async () => {
          const amount = page.getByPlaceholder(en.send.amount, { exact: true });
          await amount.fill(entered);
          await expect(amount).toHaveValue(entered);
          await page
            .getByRole('button', { name: en.buttons.next, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/send\/confirm$/);
          await expect(page.locator('p.text-2xl')).toHaveText(
            `${canonical} TSYS`
          );
          await expect(
            page.getByRole('button', { name: en.buttons.confirm, exact: true })
          ).toBeEnabled();
          await info.attach(`native-amount-${entered}`, {
            body: await page.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          expect(routes.deniedWrites).toEqual([]);
        }
      );
      await wallet.step(
        `return without signing and retain ${entered}`,
        async () => {
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/send\/sys$/);
          await expect(
            page.getByPlaceholder(en.send.amount, { exact: true })
          ).toHaveValue(entered);
          await expect(
            page.getByPlaceholder(en.send.receiver, { exact: true })
          ).toHaveValue(fixture.recipientAddress);
          expect(routes.deniedWrites).toEqual([]);
        }
      );
    }
    await info.attach('native-amount-observations', {
      body: JSON.stringify(
        {
          runtime: extensionEvidence(),
          amounts,
          signingApproved: false,
          deniedWrites: routes.deniedWrites,
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    expect(pageErrors).toEqual([]);
    status = 'passed';
  } finally {
    await wallet?.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
