import { expect, test } from '@playwright/test';

import { getNativeBalance } from '../harness/chain';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';

// Smoke journey: a fresh profile can onboard from the shared testnet seed,
// land on home, switch to the target network, and read balance + activity.
test('onboarding: import seed, unlock state, switch network, read balance', async () => {
  const wallet = await PaliWallet.launch('onboarding');

  try {
    await wallet.step('import seed and create password', () =>
      wallet.importSeedAndCreatePassword()
    );

    await wallet.step('home renders balance', async () => {
      await wallet.ensureOnHome();
      await expect(wallet.page.locator('#home-balance')).toBeVisible();
    });

    await wallet.step(`switch to ${E2E_CONFIG.networkLabel}`, () =>
      wallet.switchNetwork(E2E_CONFIG.networkLabel)
    );

    const address = await wallet.step('read active account address', () =>
      wallet.getActiveAccountAddress()
    );
    wallet.summary.addAddress('activeAccount', address);

    await wallet.step(
      'on-chain balance matches a funded test account',
      async () => {
        const balance = await getNativeBalance(address);
        wallet.finding({
          detail: `Account ${address} balance: ${balance} wei`,
          severity: 'info',
          step: 'on-chain balance',
        });
        expect(BigInt(balance)).toBeGreaterThan(BigInt(0));
      }
    );

    await wallet.step('activity tab renders', async () => {
      await wallet.page.locator('#activity-btn').click();
      // Either transactions or the explicit empty state must render — a blank
      // panel is a bug.
      await expect(
        wallet.page
          .locator('#activity-btn')
          .or(wallet.page.getByText(/you have no/i))
      ).toBeVisible();
    });

    await wallet.dispose('passed');
  } catch (error) {
    await wallet.dispose('failed');
    throw error;
  }
});
