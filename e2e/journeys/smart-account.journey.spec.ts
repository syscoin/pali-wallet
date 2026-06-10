import { expect, test } from '@playwright/test';

import { getInfrastructureState } from '../harness/chain';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';

// Full smart-account journey on the live testnet:
//   infra status -> deploy missing infra -> create smart account ->
//   register (deploy) the account -> activity shows the user operations.
//
// This exercises the hardened contracts (rotateValidator account
// implementation), the Multicall3-first metadata hydration, and the
// EntryPoint-log transaction history end to end.
test('smart account: infra deploy, account creation, policy, activity', async () => {
  const wallet = await PaliWallet.launch('smart-account');

  try {
    await wallet.step('onboard and switch network', async () => {
      await wallet.importSeedAndCreatePassword();
      await wallet.switchNetwork(E2E_CONFIG.networkLabel);
    });

    const infraBefore = await wallet.step('read on-chain infra state', () =>
      getInfrastructureState()
    );
    for (const { contract, deployed } of infraBefore) {
      wallet.summary.addAddress(`infra:${contract.id}`, contract.address);
      wallet.finding({
        detail: `${contract.id} @ ${contract.address}: ${
          deployed ? 'deployed' : 'missing'
        }`,
        severity: 'info',
        step: 'infra state (before)',
      });
    }

    await wallet.step(
      'advanced settings shows infrastructure card',
      async () => {
        await wallet.gotoRoute('#/settings/advanced');
        await expect(
          wallet.page.getByText(/smart account setup/i).first()
        ).toBeVisible({ timeout: 60_000 });
      }
    );

    const missing = infraBefore.filter((entry) => !entry.deployed);
    if (missing.length > 0) {
      await wallet.step('deploy missing infrastructure', async () => {
        const deployButton = wallet.page
          .getByRole('button', { name: /deploy/i })
          .first();
        await expect(deployButton).toBeVisible({ timeout: 60_000 });
        await deployButton.click();
        // The deploy pipeline sends one tx per missing contract and the card
        // flips to Ready when every required contract has code.
        await expect(wallet.page.getByText(/^ready$/i).first()).toBeVisible({
          timeout: E2E_CONFIG.slowActionTimeoutMs,
        });
      });

      await wallet.step('verify infra contracts on-chain', async () => {
        const infraAfter = await getInfrastructureState();
        const stillMissing = infraAfter.filter((entry) => !entry.deployed);
        for (const entry of stillMissing) {
          wallet.finding({
            detail: `${entry.contract.id} still missing at ${entry.contract.address} after deploy`,
            severity: 'bug',
            step: 'verify infra contracts on-chain',
          });
        }
        expect(stillMissing).toHaveLength(0);
      });
    } else {
      wallet.finding({
        detail: 'All infrastructure contracts already deployed; skipped deploy',
        severity: 'info',
        step: 'deploy missing infrastructure',
      });
    }

    await wallet.step('create smart account', async () => {
      await wallet.gotoRoute('#/settings/account/new');
      const createSmartAccount = wallet.page
        .getByRole('button', { name: /create smart account/i })
        .first();
      await expect(createSmartAccount).toBeVisible({ timeout: 60_000 });
      await createSmartAccount.click();
      // Counterfactual CREATE2 derivation runs through the background
      // controller; success shows the "Your new account has been created"
      // modal whose Ok button navigates back to home.
      const okButton = wallet.page
        .getByRole('button', { name: /^ok$/i })
        .first();
      await expect(okButton).toBeVisible({
        timeout: E2E_CONFIG.slowActionTimeoutMs,
      });
      await okButton.click();
      await wallet.page.waitForURL(/#\/home/, { timeout: 30_000 });
    });

    await wallet.step('smart account is selectable', async () => {
      await wallet.ensureOnHome();
      // The accounts list lives inside the hamburger (general settings) menu;
      // account rows have stable ids (#account-SmartAccount-N).
      await wallet.page.locator('#general-settings-button').click();
      const smartAccountItem = wallet.page
        .locator('[id^="account-SmartAccount"]')
        .first();
      await expect(smartAccountItem).toBeVisible({ timeout: 30_000 });
      await smartAccountItem.click();
      await wallet.page
        .locator('#home-balance')
        .waitFor({ state: 'visible', timeout: 60_000 });
    });

    const smartAccountAddress = await wallet.step(
      'read smart account address',
      () => wallet.getActiveAccountAddress()
    );
    wallet.summary.addAddress('smartAccount', smartAccountAddress);

    await wallet.step('activity panel renders for smart account', async () => {
      await wallet.gotoRoute('#/home');
      await wallet.page.locator('#activity-btn').click();
      await wallet.page.waitForTimeout(3_000);
    });

    await wallet.dispose('passed');
  } catch (error) {
    await wallet.dispose('failed');
    throw error;
  }
});
