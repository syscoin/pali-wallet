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

test('ordinary EVM send explains invalid inputs while keeping Next blocked', async ({}, info) => {
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SendFeedbackSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('send-validation-feedback', {
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
    await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
    const page = wallet.page;
    for (const [width, height] of [
      [320, 360],
      [400, 620],
    ]) {
      await page.setViewportSize({ width, height });
      await wallet.ensureOnHome();
      await page.locator('#send-btn').click();
      await expect(page).toHaveURL(/#\/send\/eth$/);
      const receiver = page.getByPlaceholder(en.send.receiver, { exact: true });
      const amount = page.getByPlaceholder(en.send.amount, { exact: true });
      const next = page.getByRole('button', {
        name: en.buttons.next,
        exact: true,
      });
      for (const [address, value, message] of [
        ['', '1', en.send.addressRequired],
        [fixture.evmAddresses[1], '', en.send.amountRequired],
        [fixture.evmAddresses[1], '0', en.send.invalidAmount],
        [fixture.evmAddresses[1], '-1', en.send.invalidAmount],
        ['invalid-address', '1', en.send.invalidEthAddress],
        [fixture.evmAddresses[1], '1', en.send.insufficientFunds],
      ]) {
        await wallet.step(
          `visible ${message} for ${value || 'blank'} input ${width}x${height}`,
          async () => {
            await receiver.fill(address);
            await amount.fill(value);
            await next.click();
            await expect(page).toHaveURL(/#\/send\/eth$/);
            const feedback = page.getByText(message, { exact: true });
            await expect(feedback).toBeVisible();
            await feedback.scrollIntoViewIfNeeded();
            const bounds = (await feedback.boundingBox())!;
            expect(bounds.x).toBeGreaterThanOrEqual(0);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
            await info.attach(
              `send-error-${width}-${message}-${value || 'blank'}`,
              {
                body: await page.screenshot({ animations: 'disabled' }),
                contentType: 'image/png',
              }
            );
            expect(routes.deniedWrites).toEqual([]);
          }
        );
      }
      await wallet.gotoRoute('#/home');
    }
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
